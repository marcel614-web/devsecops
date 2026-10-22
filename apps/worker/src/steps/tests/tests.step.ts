// apps/worker/src/steps/tests/tests.step.ts
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

interface PackageJson {
  scripts?: Record<string, string>;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * ExÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©cute les tests du projet.
 *
 * L'installation des dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pendances est dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©sormais assurÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e par l'ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tape
 * INSTALL_DEPS (handler dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©diÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©) : cette ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tape ne fait plus que les tests.
 */
export async function testsStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const pkgPath = path.join(ctx.workspaceDir, "package.json");

  let pkg: PackageJson | null = null;
  try {
    const content = await fs.readFile(pkgPath, "utf8");
    pkg = JSON.parse(content) as PackageJson;
  } catch {
    // Projet non-Node : on ne bloque pas le pipeline ici.
    const hasComposer = await fileExists(
      path.join(ctx.workspaceDir, "composer.json"),
    );
    const hasPython =
      (await fileExists(path.join(ctx.workspaceDir, "requirements.txt"))) ||
      (await fileExists(path.join(ctx.workspaceDir, "pyproject.toml")));

    if (hasComposer || hasPython) {
      await ctx.log(
        "warn",
        "Tests automatiques non configurÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©s pour cette technologie ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tape ignorÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e",
      );
    } else {
      await ctx.log("warn", "Aucun package.json ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tape Tests ignorÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e");
    }
    return { success: true, exitCode: 0, data: { skipped: true } };
  }

  if (!pkg) {
    await ctx.log("warn", "package.json illisible ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tape Tests ignorÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e");
    return { success: true, exitCode: 0, data: { skipped: true } };
  }

  const testScript = pkg.scripts?.test;
  const hasTest =
    testScript &&
    testScript.trim() !== "" &&
    !testScript.includes("no test specified");

  if (!hasTest) {
    await ctx.log("warn", "Aucun script 'test' ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tape ignorÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e");
    return { success: true, exitCode: 0, data: { skipped: true } };
  }

  await fs.mkdir(NPM_CACHE_DIR, { recursive: true });
  await ctx.log("info", "ExÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©cution des tests (npm test --if-present)");
  const testStart = Date.now();
  try {
    const { stdout, stderr } = await execTool(
      "npm",
      ["test", "--if-present"],
      {
        cwd: ctx.workspaceDir,
        timeout: 10 * 60_000,
        // Environnement filtrÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© : le script `test` du dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â´t est du code
        // non fiable. Il ne doit JAMAIS recevoir les secrets de la
        // plateforme (clÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© maÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â®tresse de chiffrement, JWT, DATABASE_URLÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦).
        env: buildSandboxEnv(process.env, {
          NPM_CONFIG_CACHE: NPM_CACHE_DIR,
        }),
      },
    );

    const testMs = Date.now() - testStart;
    if (stdout) await ctx.log("info", stdout.trim().slice(0, 4000));
    if (stderr) await ctx.log("debug", stderr.trim().slice(0, 4000));
    await ctx.log("info", `Tests rÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©ussis en ${(testMs / 1000).toFixed(1)}s`);
    return { success: true, exitCode: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const anyErr = err as { stdout?: string; stderr?: string; code?: number };

    if (anyErr.stdout) {
      await ctx.log("error", anyErr.stdout.trim().slice(-2000));
    }
    if (anyErr.stderr) {
      await ctx.log("error", anyErr.stderr.trim().slice(-2000));
    }
    await ctx.log("error", `Tests ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©chouÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©s (code ${anyErr.code ?? "?"}) : ${msg}`);
    return { success: false, exitCode: anyErr.code ?? 1, error: "Tests ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©chouÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©s" };
  }
}
