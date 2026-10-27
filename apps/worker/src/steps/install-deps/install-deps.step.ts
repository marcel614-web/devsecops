// apps/worker/src/steps/install-deps/install-deps.step.ts
import path from "node:path";
import fs from "node:fs/promises";
import { isTransientNetworkError } from "@devsecops/shared";
import type { ExecLikeError } from "@devsecops/shared";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import {
  openSandbox,
  type SandboxSession,
} from "../../isolation/sandbox";
import {
  loadSandboxConfig,
  type SandboxConfig,
  type SandboxTechnology,
} from "../../isolation/sandbox-config";
import {
  SandboxCancelledError,
  SandboxCommandError,
  SandboxLimitError,
  SandboxTimeoutError,
  SandboxUnavailableError,
} from "../../isolation/sandbox-errors";
import {
  SandboxPathError,
  SandboxSecurityError,
} from "../../isolation/sandbox-command";
import {
  runNodeInstall,
} from "./node-dependencies";
import { nodeInstallArgs as buildNodeInstallArgs } from "./node-dependencies";

/** Valeurs par défaut de la résilience réseau de pip. */
const DEFAULT_PIP_RETRIES = "5";
const DEFAULT_PIP_TIMEOUT_S = "60";
const DEFAULT_PIP_ATTEMPTS = "3";
const DEFAULT_PIP_RETRY_DELAY_MS = "3000";
const PIP_BIN = ".venv/bin/pip";

/**
 * Ré-exporté pour les tests et pour les autres étapes du worker : la
 * détection vit dans `@devsecops/shared` afin d'être partagée avec les
 * scanners (pip-audit, OSV...).
 */
export { isTransientNetworkError };
export type PipExecError = ExecLikeError;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pipAttempts(): number {
  return positiveInt(
    process.env.PIP_INSTALL_ATTEMPTS,
    Number(DEFAULT_PIP_ATTEMPTS),
  );
}

function pipRetryDelayMs(): number {
  return positiveInt(
    process.env.PIP_INSTALL_RETRY_DELAY_MS,
    Number(DEFAULT_PIP_RETRY_DELAY_MS),
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Arguments communs de résilience réseau passés explicitement à pip. */
function pipNetworkArgs(): string[] {
  return [
    "--disable-pip-version-check",
    "--retries",
    process.env.PIP_RETRIES ?? DEFAULT_PIP_RETRIES,
    "--timeout",
    process.env.PIP_DEFAULT_TIMEOUT ?? DEFAULT_PIP_TIMEOUT_S,
  ];
}

function tail(value: string | undefined, max = 4000): string {
  if (!value) return "";
  return value.trim().slice(-max);
}

async function logCommandFailure(
  ctx: StepContext,
  label: string,
  result: { stdout?: string; stderr?: string; exitCode: number },
): Promise<void> {
  await ctx.log("error", `${label} : code ${result.exitCode}`);
  const stdout = tail(result.stdout, 3000);
  const stderr = tail(result.stderr, 3000);
  if (stdout) await ctx.log("error", `[stdout]\n${stdout}`);
  if (stderr) await ctx.log("error", `[stderr]\n${stderr}`);
}

/**
 * Filtre la sortie de `pip freeze` avant de l'écrire sur l'hôte.
 *
 * Le fichier produit sert de cible à pip-audit dans l'étape SCA. Il ne doit
 * contenir que des épinglages `nom==version` : une ligne `-e .` ou une URL
 * directe ferait installer/construire le projet par pip-audit **sur l'hôte**,
 * ce qui réintroduirait l'exécution de code non fiable hors sandbox.
 */
export function sanitizePipFreeze(output: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;

    const match =
      /^([A-Za-z0-9][A-Za-z0-9_.-]*)(\[[A-Za-z0-9_,.-]+\])?==([^\s;]+)(\s*;.*)?$/.exec(
        line,
      );
    if (!match) continue;

    const normalized = `${match[1]}${match[2] ?? ""}==${match[3]}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    lines.push(normalized);
  }

  return lines;
}

/**
 * Exécute une commande pip dans la sandbox avec nouvelles tentatives.
 * Seules les erreurs réseau transitoires sont rejouées.
 */
async function runPip(
  session: SandboxSession,
  ctx: StepContext,
  label: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  const attempts = pipAttempts();
  const baseDelay = pipRetryDelayMs();

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await session.run({
      command: PIP_BIN,
      args,
      timeoutMs,
      network: "egress",
      label,
      env: {
        PIP_RETRIES: process.env.PIP_RETRIES ?? DEFAULT_PIP_RETRIES,
        PIP_DEFAULT_TIMEOUT:
          process.env.PIP_DEFAULT_TIMEOUT ?? DEFAULT_PIP_TIMEOUT_S,
      },
    });

    if (result.exitCode === 0) return;

    const errorLike: ExecLikeError = {
      code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    const transient = isTransientNetworkError(errorLike);
    if (!transient || attempt >= attempts) {
      throw new SandboxCommandError(label, result);
    }

    const waitMs = baseDelay * attempt;
    await ctx.log(
      "warn",
      `${label} : erreur réseau transitoire (tentative ${attempt}/${attempts}), ` +
        `nouvelle tentative dans ${Math.round(waitMs / 1000)}s`,
    );
    const stderr = tail(result.stderr, 1000);
    if (stderr) await ctx.log("debug", stderr);
    await delay(waitMs);
  }
}

async function assertWorkspaceLimit(
  session: SandboxSession,
  ctx: StepContext,
  config: SandboxConfig,
): Promise<void> {
  try {
    const size = await session.workspaceSizeMb();
    await ctx.log("info", `Taille du workspace sandbox : ${size.toFixed(1)} Mo`);
    if (size > config.limits.maxWorkspaceMb) {
      await session.destroy();
      throw new SandboxLimitError(
        `Workspace de sandbox trop volumineux : ${size.toFixed(1)} Mo > ` +
          `${config.limits.maxWorkspaceMb} Mo`,
      );
    }
  } catch (err) {
    if (err instanceof SandboxLimitError) throw err;
    await ctx.log(
      "warn",
      `Impossible de mesurer le workspace de sandbox : ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function installNode(
  session: SandboxSession,
  ctx: StepContext,
  config: SandboxConfig,
): Promise<StepResult> {
  const lockfile = await fileExists(
    path.join(ctx.workspaceDir, "package-lock.json"),
  );
  await ctx.log(
    "info",
    `Installation Node.js dans la sandbox (${lockfile ? "npm ci" : "npm install"})...`,
  );

  const started = Date.now();
  const result = await runNodeInstall(
    session,
    ctx.workspaceDir,
    config.installTimeoutMs,
  );
  if (result.exitCode !== 0) {
    await logCommandFailure(ctx, "npm install", result);
    return {
      success: false,
      exitCode: result.exitCode,
      error: "Installation des dépendances Node.js échouée",
    };
  }

  await ctx.log(
    "info",
    `Dépendances Node.js installées en ${(
      (Date.now() - started) / 1000
    ).toFixed(1)}s`,
  );

  // npm peut créer un lockfile : on le rapatrie pour que le SCA et le build
  // Docker disposent des versions réellement résolues.
  try {
    await session.syncBack(["package-lock.json", "npm-shrinkwrap.json"]);
  } catch (err) {
    await ctx.log(
      "warn",
      `Lockfile npm non rapatrié : ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  await assertWorkspaceLimit(session, ctx, config);
  return { success: true, exitCode: 0, data: { technology: "NODEJS" } };
}

async function installPhp(
  session: SandboxSession,
  ctx: StepContext,
  config: SandboxConfig,
): Promise<StepResult> {
  await ctx.log(
    "info",
    "Installation des dépendances PHP dans la sandbox (composer install)...",
  );

  const result = await session.run({
    command: "composer",
    args: [
      "install",
      "--no-interaction",
      "--prefer-dist",
      "--no-progress",
      "--no-ansi",
    ],
    timeoutMs: config.installTimeoutMs,
    network: "egress",
    label: "composer install",
  });

  if (result.exitCode !== 0) {
    await logCommandFailure(ctx, "composer install", result);
    return {
      success: false,
      exitCode: result.exitCode,
      error: "Installation des dépendances PHP échouée",
    };
  }

  await ctx.log("info", "Dépendances PHP installées dans la sandbox");
  try {
    await session.syncBack(["composer.lock"]);
  } catch (err) {
    await ctx.log(
      "warn",
      `composer.lock non rapatrié : ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  await assertWorkspaceLimit(session, ctx, config);
  return { success: true, exitCode: 0, data: { technology: "PHP" } };
}

async function installPython(
  session: SandboxSession,
  ctx: StepContext,
  config: SandboxConfig,
): Promise<StepResult> {
  const hasRequirements = await fileExists(
    path.join(ctx.workspaceDir, "requirements.txt"),
  );
  const hasPyproject = await fileExists(
    path.join(ctx.workspaceDir, "pyproject.toml"),
  );

  if (!hasRequirements && !hasPyproject) {
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "no python dependency file" },
    };
  }

  if (process.env.PIP_WHEELHOUSE) {
    await ctx.log(
      "warn",
      "PIP_WHEELHOUSE est ignoré dans la sandbox : un chemin de l'hôte " +
        "n'est jamais monté. Utilisez PIP_INDEX_URL ou préchargez un miroir.",
    );
  }

  await ctx.log(
    "info",
    "Création d'un environnement virtuel Python dans la sandbox (.venv)...",
  );
  const venv = await session.run({
    command: "python",
    args: ["-m", "venv", ".venv"],
    timeoutMs: 3 * 60_000,
    network: "none",
    label: "python -m venv",
  });
  if (venv.exitCode !== 0) {
    await logCommandFailure(ctx, "python -m venv", venv);
    return {
      success: false,
      exitCode: venv.exitCode || 1,
      error: "Création de l'environnement Python échouée dans la sandbox",
    };
  }

  const packageArgs = hasRequirements ? ["-r", "requirements.txt"] : ["."];
  await ctx.log(
    "info",
    `Installation des dépendances Python dans la sandbox ` +
      `(pip install ${packageArgs.join(" ")})...`,
  );

  await runPip(
    session,
    ctx,
    "pip install",
    ["install", ...packageArgs, ...pipNetworkArgs()],
    config.installTimeoutMs,
  );
  await ctx.log("info", "Dépendances Python installées dans la sandbox");

  // Le SCA Python lit le freeze rapatrié et utilise l'outil pip-audit
  // installé sur l'hôte (PIP_AUDIT_BIN). Installer pip-audit dans le venv de
  // la sandbox ne servirait à rien : le venv n'est pas rapatrié, et cela
  // ajoutait plusieurs minutes de téléchargement par pipeline.
  const freeze = await session.run({
    command: PIP_BIN,
    args: ["freeze"],
    timeoutMs: 2 * 60_000,
    network: "none",
    label: "pip freeze",
  });
  if (freeze.exitCode !== 0) {
    await ctx.log(
      "warn",
      "pip freeze a échoué : le SCA Python utilisera requirements.txt s'il existe",
    );
  } else {
    const lines = sanitizePipFreeze(freeze.stdout);
    if (lines.length === 0) {
      await ctx.log(
        "warn",
        "pip freeze ne contient aucun paquet épinglable : freeze non écrit",
      );
    } else {
      const freezePath = path.join(
        ctx.workspaceDir,
        ".devsecops",
        "pip-freeze.txt",
      );
      await fs.mkdir(path.dirname(freezePath), { recursive: true });
      await fs.writeFile(freezePath, `${lines.join("\n")}\n`, "utf8");
      await ctx.log(
        "info",
        `Freeze Python rapatrié (${lines.length} paquets) pour le SCA`,
      );
    }
  }

  await assertWorkspaceLimit(session, ctx, config);
  return { success: true, exitCode: 0, data: { technology: "PYTHON" } };
}

type Technology = "NODEJS" | "PHP" | "PYTHON";

async function detectTechnology(
  workspaceDir: string,
): Promise<Technology | null> {
  if (await fileExists(path.join(workspaceDir, "package.json"))) {
    return "NODEJS";
  }
  if (await fileExists(path.join(workspaceDir, "composer.json"))) {
    return "PHP";
  }
  if (
    (await fileExists(path.join(workspaceDir, "requirements.txt"))) ||
    (await fileExists(path.join(workspaceDir, "pyproject.toml")))
  ) {
    return "PYTHON";
  }
  return null;
}

async function sandboxFailureResult(
  ctx: StepContext,
  err: unknown,
  label: string,
): Promise<StepResult> {
  if (err instanceof SandboxCancelledError) {
    await ctx.log("warn", `${label} : exécution annulée`);
    return {
      success: false,
      cancelled: true,
      exitCode: 130,
      error: "Exécution annulée",
    };
  }

  if (err instanceof SandboxTimeoutError) {
    await ctx.log("error", `${label} : ${err.message}`);
    return {
      success: false,
      exitCode: 124,
      error: `${label} : délai maximal de la sandbox dépassé`,
    };
  }

  if (err instanceof SandboxUnavailableError) {
    await ctx.log("error", `${label} : sandbox indisponible — ${err.message}`);
    return {
      success: false,
      exitCode: 1,
      error: `${label} : sandbox indisponible (aucune exécution sur l'hôte)`,
    };
  }

  if (err instanceof SandboxPathError || err instanceof SandboxSecurityError) {
    await ctx.log("error", `${label} : refus de sécurité — ${err.message}`);
    return {
      success: false,
      exitCode: 1,
      error: `${label} : configuration de sandbox refusée`,
    };
  }

  if (err instanceof SandboxCommandError) {
    await logCommandFailure(ctx, err.label, err.result);
    const errorLike: ExecLikeError = {
      code: err.result.exitCode,
      stdout: err.result.stdout,
      stderr: err.result.stderr,
    };
    if (isTransientNetworkError(errorLike)) {
      await ctx.log(
        "error",
        "Réseau du gestionnaire de paquets indisponible après plusieurs " +
          "tentatives. Vérifiez la résolution DNS du moteur de sandbox, ou " +
          "configurez PIP_INDEX_URL / NPM_CONFIG_REGISTRY.",
      );
    }
    return {
      success: false,
      exitCode: err.result.exitCode,
      error: `${label} : ${err.label} a échoué`,
    };
  }

  if (err instanceof SandboxLimitError) {
    await ctx.log("error", `${label} : ${err.message}`);
    return {
      success: false,
      exitCode: 1,
      error: `${label} : limite de ressources dépassée`,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  await ctx.log("error", `${label} : ${message}`);
  return {
    success: false,
    exitCode: 1,
    error: `${label} échouée`,
  };
}

/**
 * Installe les dépendances selon la technologie détectée.
 *
 * Toutes les commandes de gestionnaire de paquets s'exécutent dans une
 * sandbox Docker. Si aucun moteur n'est disponible, l'étape échoue
 * explicitement : il n'existe aucun repli vers une exécution sur l'hôte.
 */
export async function installDepsStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const technology = await detectTechnology(ctx.workspaceDir);
  if (!technology) {
    await ctx.log(
      "warn",
      "Aucun fichier de dépendances reconnu — étape ignorée",
    );
    return { success: true, exitCode: 0, data: { skipped: true } };
  }

  let config: SandboxConfig;
  try {
    config = loadSandboxConfig();
  } catch (err) {
    await ctx.log(
      "error",
      `Configuration de la sandbox invalide : ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return {
      success: false,
      exitCode: 1,
      error: "Configuration de la sandbox invalide",
    };
  }

  let session: SandboxSession | null = null;
  try {
    session = await openSandbox(
      {
        pipelineId: ctx.pipelineId,
        projectId: ctx.projectId,
        workspaceDir: ctx.workspaceDir,
        technology: technology as SandboxTechnology,
      },
      { log: ctx.log, isCancelled: ctx.isCancelled },
    );

    let result: StepResult;
    if (technology === "NODEJS") {
      result = await installNode(session, ctx, config);
    } else if (technology === "PHP") {
      result = await installPhp(session, ctx, config);
    } else {
      result = await installPython(session, ctx, config);
    }

    if (!result.success || result.data?.skipped === true) {
      await session.destroy().catch(() => undefined);
    }
    return result;
  } catch (err) {
    if (session) {
      await session.destroy().catch(() => undefined);
    }
    return sandboxFailureResult(ctx, err, "Installation des dépendances");
  }
}

// Exporté pour les tests unitaires de la construction d'arguments npm.
export { buildNodeInstallArgs as nodeInstallArgs };
