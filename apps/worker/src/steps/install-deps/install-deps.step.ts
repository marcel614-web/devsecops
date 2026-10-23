// apps/worker/src/steps/install-deps/install-deps.step.ts
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { execTool, isTransientNetworkError } from "@devsecops/shared";
import type { ExecLikeError } from "@devsecops/shared";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import { buildSandboxEnv } from "../../utils/sandbox-env";

const NPM_CACHE_DIR =
  process.platform === "win32"
    ? path.join(os.homedir(), "AppData", "Local", "devsecops", "npm-cache")
    : path.join(os.homedir(), ".cache", "devsecops", "npm-cache");

const PIP_CACHE_DIR =
  process.platform === "win32"
    ? path.join(os.homedir(), "AppData", "Local", "devsecops", "pip-cache")
    : path.join(os.homedir(), ".cache", "devsecops", "pip-cache");

const COMPOSER_BIN = process.env.COMPOSER_BIN ?? "composer";
const PYTHON_BIN = process.env.PYTHON_BIN ?? "python";

/** Valeurs par défaut de la résilience réseau de pip. */
const DEFAULT_PIP_RETRIES = "5";
const DEFAULT_PIP_TIMEOUT_S = "60";
const DEFAULT_PIP_ATTEMPTS = "3";
const DEFAULT_PIP_RETRY_DELAY_MS = "3000";

/**
 * Ré-exporté pour les tests et pour les autres étapes du worker : la
 * détection vit désormais dans `@devsecops/shared` afin d'être partagée
 * avec les scanners (pip-audit, OSV...).
 */
export { isTransientNetworkError };
export type PipExecError = ExecLikeError;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pipAttempts(): number {
  return positiveInt(process.env.PIP_INSTALL_ATTEMPTS, Number(DEFAULT_PIP_ATTEMPTS));
}

function pipRetryDelayMs(): number {
  return positiveInt(
    process.env.PIP_INSTALL_RETRY_DELAY_MS,
    Number(DEFAULT_PIP_RETRY_DELAY_MS),
  );
}

/**
 * Environnement des gestionnaires de dépendances exécutés dans le workspace
 * du dépôt cloné.
 *
 * `pip install .` et `composer install` exécutent du code du dépôt
 * (`setup.py`, build backend PEP 517, scripts Composer). Ils ne doivent donc
 * jamais hériter de `process.env` complet : sinon un dépôt malveillant peut
 * lire DATABASE_URL, MASTER_ENCRYPTION_KEY, les JWT, etc.
 *
 * Les variables `PIP_*` de transport (index miroir, proxy, délais) sont en
 * revanche volontairement transmises : elles ne contiennent pas de secret
 * de plateforme et permettent de s'adapter à un réseau filtré.
 */
export function buildDependencyEnv(
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return buildSandboxEnv(process.env, {
    PIP_CACHE_DIR,
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_NO_INPUT: "1",
    PIP_RETRIES: process.env.PIP_RETRIES ?? DEFAULT_PIP_RETRIES,
    PIP_DEFAULT_TIMEOUT:
      process.env.PIP_DEFAULT_TIMEOUT ?? DEFAULT_PIP_TIMEOUT_S,
    PIP_INDEX_URL: process.env.PIP_INDEX_URL,
    PIP_EXTRA_INDEX_URL: process.env.PIP_EXTRA_INDEX_URL,
    PIP_TRUSTED_HOST: process.env.PIP_TRUSTED_HOST,
    ...extra,
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(command: string, args: string[]): Promise<boolean> {
  try {
    await execTool(command, args, { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exécute une commande pip avec nouvelles tentatives et backoff linéaire.
 * Seules les erreurs réseau transitoires sont rejouées : une erreur de
 * dépendance (version introuvable, build cassé) échoue immédiatement.
 */
async function runPip(
  ctx: StepContext,
  label: string,
  pipBin: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  const attempts = pipAttempts();
  const baseDelay = pipRetryDelayMs();

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await execTool(pipBin, args, {
        cwd: ctx.workspaceDir,
        timeout: timeoutMs,
        maxBuffer: 30 * 1024 * 1024,
        env: buildDependencyEnv(),
      });
      if (result.stdout) {
        await ctx.log("debug", result.stdout.trim().slice(-2000));
      }
      return;
    } catch (err) {
      const transient = isTransientNetworkError(err);
      if (!transient || attempt >= attempts) throw err;

      const waitMs = baseDelay * attempt;
      await ctx.log(
        "warn",
        `${label} : erreur réseau transitoire (tentative ${attempt}/${attempts}), ` +
          `nouvelle tentative dans ${Math.round(waitMs / 1000)}s`,
      );
      const anyErr = err as PipExecError;
      if (anyErr.stderr) {
        await ctx.log("debug", anyErr.stderr.trim().slice(-1000));
      }
      await delay(waitMs);
    }
  }
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

/**
 * Installe des paquets Python, avec repli hors ligne sur un wheelhouse local
 * (`PIP_WHEELHOUSE`) si PyPI reste injoignable.
 */
async function installPythonPackages(
  ctx: StepContext,
  pipBin: string,
  packageArgs: string[],
  timeoutMs: number,
): Promise<void> {
  const wheelhouse = process.env.PIP_WHEELHOUSE;

  try {
    await runPip(
      ctx,
      "pip install",
      pipBin,
      ["install", ...packageArgs, ...pipNetworkArgs()],
      timeoutMs,
    );
    return;
  } catch (err) {
    if (!wheelhouse || !isTransientNetworkError(err)) throw err;
    if (!(await fileExists(wheelhouse))) {
      await ctx.log(
        "warn",
        `PIP_WHEELHOUSE est défini mais introuvable (${wheelhouse})`,
      );
      throw err;
    }
    await ctx.log(
      "warn",
      `PyPI injoignable, tentative d'installation hors ligne depuis ${wheelhouse}...`,
    );
    await runPip(
      ctx,
      "pip install (wheelhouse)",
      pipBin,
      [
        "install",
        ...packageArgs,
        "--no-index",
        "--find-links",
        wheelhouse,
        ...pipNetworkArgs(),
      ],
      timeoutMs,
    );
  }
}

async function installNode(ctx: StepContext): Promise<StepResult> {
  const hasLockfile = await fileExists(
    path.join(ctx.workspaceDir, "package-lock.json"),
  );

  const args = hasLockfile
    ? [
        "ci",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        "--no-engine-strict",
        "--prefer-offline",
      ]
    : [
        "install",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        "--no-engine-strict",
        "--prefer-offline",
        "--legacy-peer-deps",
      ];

  await fs.mkdir(NPM_CACHE_DIR, { recursive: true });
  await ctx.log(
    "info",
    `Installation Node.js (${hasLockfile ? "npm ci" : "npm install"})...`,
  );

  const started = Date.now();
  try {
    await execTool("npm", args, {
      cwd: ctx.workspaceDir,
      timeout: 10 * 60_000,
      // Environnement filtré : le code du dépôt ne doit jamais voir les
      // secrets de la plateforme (clé maîtresse, JWT, accès base...).
      env: buildSandboxEnv(process.env, {
        NPM_CONFIG_CACHE: NPM_CACHE_DIR,
        NPM_CONFIG_PREFER_OFFLINE: "true",
        NPM_CONFIG_AUDIT: "false",
        NPM_CONFIG_FUND: "false",
      }),
    });
    await ctx.log(
      "info",
      `Dépendances Node.js installées en ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    return { success: true, exitCode: 0, data: { technology: "NODEJS" } };
  } catch (err) {
    const anyErr = err as { stdout?: string; stderr?: string; code?: number };
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Échec npm (code ${anyErr.code ?? "?"}) : ${msg}`);
    if (anyErr.stdout) {
      await ctx.log("error", `[npm stdout]\n${anyErr.stdout.trim().slice(-3000)}`);
    }
    if (anyErr.stderr) {
      await ctx.log("error", `[npm stderr]\n${anyErr.stderr.trim().slice(-3000)}`);
    }
    return {
      success: false,
      exitCode: anyErr.code ?? 1,
      error: "Installation des dépendances Node.js échouée",
    };
  }
}

async function installPhp(ctx: StepContext): Promise<StepResult> {
  if (!(await commandExists(COMPOSER_BIN, ["--version"]))) {
    await ctx.log(
      "warn",
      "Composer non installé — installation des dépendances PHP ignorée",
    );
    return {
      success: true,
      exitCode: 0,
      data: {
        skipped: true,
        reason: "composer not found",
        technology: "PHP",
      },
    };
  }

  await ctx.log("info", "Installation des dépendances PHP (composer install)...");
  try {
    const result = await execTool(
      COMPOSER_BIN,
      ["install", "--no-interaction", "--prefer-dist", "--no-progress", "--no-ansi"],
      {
        cwd: ctx.workspaceDir,
        timeout: 10 * 60_000,
        maxBuffer: 30 * 1024 * 1024,
        env: buildDependencyEnv(),
      },
    );
    if (result.stdout) {
      await ctx.log("debug", result.stdout.trim().slice(-2000));
    }
    await ctx.log("info", "Dépendances PHP installées");
    return { success: true, exitCode: 0, data: { technology: "PHP" } };
  } catch (err) {
    const anyErr = err as { stdout?: string; stderr?: string; code?: number };
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Échec composer install : ${msg}`);
    if (anyErr.stderr) {
      await ctx.log("error", anyErr.stderr.trim().slice(-3000));
    }
    return {
      success: false,
      exitCode: anyErr.code ?? 1,
      error: "Installation des dépendances PHP échouée",
    };
  }
}

async function installPython(ctx: StepContext): Promise<StepResult> {
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

  if (!(await commandExists(PYTHON_BIN, ["--version"]))) {
    await ctx.log(
      "warn",
      "Python non installé — installation des dépendances Python ignorée",
    );
    return {
      success: true,
      exitCode: 0,
      data: {
        skipped: true,
        reason: "python not found",
        technology: "PYTHON",
      },
    };
  }

  const venvDir = path.join(ctx.workspaceDir, ".venv");
  const pipBin = path.join(
    venvDir,
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "pip.exe" : "pip",
  );

  await ctx.log("info", "Création d'un environnement virtuel Python (.venv)...");
  try {
    await execTool(PYTHON_BIN, ["-m", "venv", ".venv"], {
      cwd: ctx.workspaceDir,
      timeout: 3 * 60_000,
      env: buildDependencyEnv(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("warn", `Impossible de créer le venv Python : ${msg}`);
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "python venv failed", technology: "PYTHON" },
    };
  }

  const packageArgs = hasRequirements ? ["-r", "requirements.txt"] : ["."];

  await ctx.log(
    "info",
    `Installation des dépendances Python (pip install ${packageArgs.join(" ")})...`,
  );
  try {
    await installPythonPackages(ctx, pipBin, packageArgs, 10 * 60_000);
    await ctx.log("info", "Dépendances Python installées");

    // Installe pip-audit dans le venv pour le SCA Python. Non bloquant :
    // le scanner peut aussi utiliser un binaire global.
    try {
      await runPip(
        ctx,
        "pip install pip-audit",
        pipBin,
        ["install", "pip-audit", ...pipNetworkArgs()],
        5 * 60_000,
      );
      await ctx.log("info", "pip-audit installé dans le venv");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.log(
        "warn",
        `pip-audit non installé dans le venv (SCA Python utilisera le binaire global) : ${msg}`,
      );
    }

    return { success: true, exitCode: 0, data: { technology: "PYTHON" } };
  } catch (err) {
    const anyErr = err as PipExecError;
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Échec pip install : ${msg}`);
    if (anyErr.stderr) {
      await ctx.log("error", anyErr.stderr.trim().slice(-3000));
    }
    if (isTransientNetworkError(err)) {
      await ctx.log(
        "error",
        "Réseau PyPI indisponible après plusieurs tentatives. " +
          "Vérifiez la résolution DNS de pypi.org, ou configurez " +
          "PIP_INDEX_URL (miroir) / PIP_WHEELHOUSE (cache local).",
      );
    }
    return {
      success: false,
      exitCode: typeof anyErr.code === "number" ? anyErr.code : 1,
      error: isTransientNetworkError(err)
        ? "Installation des dépendances Python échouée (réseau PyPI indisponible)"
        : "Installation des dépendances Python échouée",
    };
  }
}

/**
 * Installe les dépendances selon la technologie détectée.
 * Remplace l'installation qui était faite implicitement dans l'étape Tests.
 */
export async function installDepsStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  if (await fileExists(path.join(ctx.workspaceDir, "package.json"))) {
    return installNode(ctx);
  }
  if (await fileExists(path.join(ctx.workspaceDir, "composer.json"))) {
    return installPhp(ctx);
  }
  if (
    (await fileExists(path.join(ctx.workspaceDir, "requirements.txt"))) ||
    (await fileExists(path.join(ctx.workspaceDir, "pyproject.toml")))
  ) {
    return installPython(ctx);
  }

  await ctx.log(
    "warn",
    "Aucun fichier de dépendances reconnu — étape ignorée",
  );
  return { success: true, exitCode: 0, data: { skipped: true } };
}
