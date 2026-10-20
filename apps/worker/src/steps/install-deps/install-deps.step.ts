// apps/worker/src/steps/install-deps/install-deps.step.ts
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { execFileAsync } from "../../orchestrator/step.executor";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

const NPM_CACHE_DIR =
  process.platform === "win32"
    ? path.join(os.homedir(), "AppData", "Local", "devsecops", "npm-cache")
    : path.join(os.homedir(), ".cache", "devsecops", "npm-cache");

const COMPOSER_BIN = process.env.COMPOSER_BIN ?? "composer";
const PYTHON_BIN = process.env.PYTHON_BIN ?? "python";

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
    await execFileAsync(command, args, { timeout: 30_000, shell: true });
    return true;
  } catch {
    return false;
  }
}

async function installNode(
  ctx: StepContext,
): Promise<StepResult> {
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
    await execFileAsync("npm", args, {
      cwd: ctx.workspaceDir,
      timeout: 10 * 60_000,
      shell: true,
      env: {
        ...process.env,
        NPM_CONFIG_CACHE: NPM_CACHE_DIR,
        NPM_CONFIG_PREFER_OFFLINE: "true",
        NPM_CONFIG_AUDIT: "false",
        NPM_CONFIG_FUND: "false",
      },
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
    const result = await execFileAsync(
      COMPOSER_BIN,
      ["install", "--no-interaction", "--prefer-dist", "--no-progress", "--no-ansi"],
      {
        cwd: ctx.workspaceDir,
        timeout: 10 * 60_000,
        maxBuffer: 30 * 1024 * 1024,
        shell: true,
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
    await execFileAsync(PYTHON_BIN, ["-m", "venv", ".venv"], {
      cwd: ctx.workspaceDir,
      timeout: 3 * 60_000,
      shell: true,
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

  const args = hasRequirements
    ? ["install", "-r", "requirements.txt", "--disable-pip-version-check"]
    : ["install", ".", "--disable-pip-version-check"];

  await ctx.log("info", `Installation des dépendances Python (${args.join(" ")})...`);
  try {
    await execFileAsync(pipBin, args, {
      cwd: ctx.workspaceDir,
      timeout: 10 * 60_000,
      maxBuffer: 30 * 1024 * 1024,
      shell: true,
    });
    await ctx.log("info", "Dépendances Python installées");

    // Installe pip-audit dans le venv pour le SCA Python. Non bloquant :
    // le scanner peut aussi utiliser un binaire global.
    try {
      await execFileAsync(
        pipBin,
        ["install", "--disable-pip-version-check", "pip-audit"],
        {
          cwd: ctx.workspaceDir,
          timeout: 5 * 60_000,
          maxBuffer: 30 * 1024 * 1024,
          shell: true,
        },
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
    const anyErr = err as { stderr?: string; code?: number };
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Échec pip install : ${msg}`);
    if (anyErr.stderr) {
      await ctx.log("error", anyErr.stderr.trim().slice(-3000));
    }
    return {
      success: false,
      exitCode: anyErr.code ?? 1,
      error: "Installation des dépendances Python échouée",
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

  await ctx.log("warn", "Aucun fichier de dépendances reconnu — étape ignorée");
  return { success: true, exitCode: 0, data: { skipped: true } };
}
