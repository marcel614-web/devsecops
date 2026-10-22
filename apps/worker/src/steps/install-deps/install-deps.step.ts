// apps/worker/src/steps/install-deps/install-deps.step.ts
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { execTool } from "@devsecops/shared";
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

/**
 * Environnement des gestionnaires de dépendances exécutés dans le workspace
 * du dépôt cloné.
 *
 * `pip install .` et `composer install` exécutent du code du dépôt
 * (`setup.py`, build backend PEP 517, scripts Composer). Ils ne doivent donc
 * jamais hériter de `process.env` complet : sinon un dépôt malveillant peut
 * lire DATABASE_URL, MASTER_ENCRYPTION_KEY, les JWT, etc.
 */
export function buildDependencyEnv(
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return buildSandboxEnv(process.env, {
    PIP_CACHE_DIR,
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_NO_INPUT: "1",
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
    await execTool("npm", args, {
      cwd: ctx.workspaceDir,
      timeout: 10 * 60_000,
      // Environnement filtrÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© : le code du dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â´t ne doit jamais voir les
      // secrets de la plateforme (clÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© maÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â®tresse, JWT, accÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¨s baseÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦).
      env: buildSandboxEnv(process.env, {
        NPM_CONFIG_CACHE: NPM_CACHE_DIR,
        NPM_CONFIG_PREFER_OFFLINE: "true",
        NPM_CONFIG_AUDIT: "false",
        NPM_CONFIG_FUND: "false",
      }),
    });
    await ctx.log(
      "info",
      `DÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances Node.js installÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©es en ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    return { success: true, exitCode: 0, data: { technology: "NODEJS" } };
  } catch (err) {
    const anyErr = err as { stdout?: string; stderr?: string; code?: number };
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°chec npm (code ${anyErr.code ?? "?"}) : ${msg}`);
    if (anyErr.stdout) {
      await ctx.log("error", `[npm stdout]\n${anyErr.stdout.trim().slice(-3000)}`);
    }
    if (anyErr.stderr) {
      await ctx.log("error", `[npm stderr]\n${anyErr.stderr.trim().slice(-3000)}`);
    }
    return {
      success: false,
      exitCode: anyErr.code ?? 1,
      error: "Installation des dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances Node.js ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©chouÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e",
    };
  }
}

async function installPhp(ctx: StepContext): Promise<StepResult> {
  if (!(await commandExists(COMPOSER_BIN, ["--version"]))) {
    await ctx.log(
      "warn",
      "Composer non installÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â installation des dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances PHP ignorÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e",
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

  await ctx.log("info", "Installation des dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances PHP (composer install)...");
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
    await ctx.log("info", "DÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances PHP installÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©es");
    return { success: true, exitCode: 0, data: { technology: "PHP" } };
  } catch (err) {
    const anyErr = err as { stdout?: string; stderr?: string; code?: number };
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°chec composer install : ${msg}`);
    if (anyErr.stderr) {
      await ctx.log("error", anyErr.stderr.trim().slice(-3000));
    }
    return {
      success: false,
      exitCode: anyErr.code ?? 1,
      error: "Installation des dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances PHP ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©chouÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e",
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
      "Python non installÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â installation des dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances Python ignorÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e",
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

  await ctx.log("info", "CrÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©ation d'un environnement virtuel Python (.venv)...");
  try {
    await execTool(PYTHON_BIN, ["-m", "venv", ".venv"], {
      cwd: ctx.workspaceDir,
      timeout: 3 * 60_000,
      env: buildDependencyEnv(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("warn", `Impossible de crÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©er le venv Python : ${msg}`);
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "python venv failed", technology: "PYTHON" },
    };
  }

  const args = hasRequirements
    ? ["install", "-r", "requirements.txt", "--disable-pip-version-check"]
    : ["install", ".", "--disable-pip-version-check"];

  await ctx.log("info", `Installation des dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances Python (${args.join(" ")})...`);
  try {
    await execTool(pipBin, args, {
      cwd: ctx.workspaceDir,
      timeout: 10 * 60_000,
      maxBuffer: 30 * 1024 * 1024,
      env: buildDependencyEnv(),
    });
    await ctx.log("info", "DÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances Python installÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©es");

    // Installe pip-audit dans le venv pour le SCA Python. Non bloquant :
    // le scanner peut aussi utiliser un binaire global.
    try {
      await execTool(
        pipBin,
        ["install", "--disable-pip-version-check", "pip-audit"],
        {
          cwd: ctx.workspaceDir,
          timeout: 5 * 60_000,
          maxBuffer: 30 * 1024 * 1024,
          env: buildDependencyEnv(),
        },
      );
      await ctx.log("info", "pip-audit installÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© dans le venv");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.log(
        "warn",
        `pip-audit non installÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© dans le venv (SCA Python utilisera le binaire global) : ${msg}`,
      );
    }

    return { success: true, exitCode: 0, data: { technology: "PYTHON" } };
  } catch (err) {
    const anyErr = err as { stderr?: string; code?: number };
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°chec pip install : ${msg}`);
    if (anyErr.stderr) {
      await ctx.log("error", anyErr.stderr.trim().slice(-3000));
    }
    return {
      success: false,
      exitCode: anyErr.code ?? 1,
      error: "Installation des dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances Python ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©chouÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e",
    };
  }
}

/**
 * Installe les dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances selon la technologie dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tectÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e.
 * Remplace l'installation qui ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tait faite implicitement dans l'ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tape Tests.
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

  await ctx.log("warn", "Aucun fichier de dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances reconnu ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tape ignorÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e");
  return { success: true, exitCode: 0, data: { skipped: true } };
}
