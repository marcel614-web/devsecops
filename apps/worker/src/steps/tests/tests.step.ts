// apps/worker/src/steps/tests/tests.step.ts
import path from "node:path";
import fs from "node:fs/promises";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import {
  destroySandbox,
  openSandbox,
  type SandboxSession,
} from "../../isolation/sandbox";
import { loadSandboxConfig } from "../../isolation/sandbox-config";
import {
  SandboxCancelledError,
  SandboxCommandError,
  SandboxTimeoutError,
  SandboxUnavailableError,
} from "../../isolation/sandbox-errors";
import {
  SandboxPathError,
  SandboxSecurityError,
} from "../../isolation/sandbox-command";
import { ensureNodeModules } from "../install-deps/node-dependencies";

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

function tail(value: string | undefined, max = 3000): string {
  return value ? value.trim().slice(-max) : "";
}

/**
 * Ignore les tests mais libère la sandbox créée par INSTALL_DEPS. Pour les
 * technologies sans exécuteur de tests (Python/PHP), la conserver jusqu'à la
 * fin du pipeline consommerait inutilement la RAM du moteur.
 */
async function skipTests(
  ctx: StepContext,
  message: string,
): Promise<StepResult> {
  await ctx.log("warn", message);
  await destroySandbox(ctx.pipelineId).catch(() => undefined);
  return { success: true, exitCode: 0, data: { skipped: true } };
}

async function failureResult(
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
    await ctx.log("error", `${err.label} : code ${err.result.exitCode}`);
    const stdout = tail(err.result.stdout);
    const stderr = tail(err.result.stderr);
    if (stdout) await ctx.log("error", `[stdout]\n${stdout}`);
    if (stderr) await ctx.log("error", `[stderr]\n${stderr}`);
    return {
      success: false,
      exitCode: err.result.exitCode,
      error: `${label} : ${err.label} a échoué`,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  await ctx.log("error", `${label} : ${message}`);
  return { success: false, exitCode: 1, error: `${label} échoués` };
}

/**
 * Exécute les tests du projet dans la sandbox.
 *
 * L'installation des dépendances est assurée par INSTALL_DEPS. Si la sandbox
 * a été détruite entre-temps (reprise de pipeline), les dépendances Node sont
 * réinstallées dans la sandbox avant les tests. Aucun test n'est exécuté sur
 * l'hôte du worker.
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
      return skipTests(
        ctx,
        "Tests automatiques non configurés pour cette technologie — étape ignorée",
      );
    }
    return skipTests(ctx, "Aucun package.json — étape Tests ignorée");
  }

  if (!pkg) {
    return skipTests(ctx, "package.json illisible — étape Tests ignorée");
  }

  const testScript = pkg.scripts?.test;
  const hasTest =
    testScript &&
    testScript.trim() !== "" &&
    !testScript.includes("no test specified");

  if (!hasTest) {
    return skipTests(ctx, "Aucun script 'test' — étape Tests ignorée");
  }

  let config;
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
        technology: "NODEJS",
      },
      { log: ctx.log, isCancelled: ctx.isCancelled },
    );

    await ensureNodeModules(
      session,
      ctx.workspaceDir,
      config.installTimeoutMs,
      ctx.log,
    );

    if (config.testNetwork === "egress") {
      await ctx.log(
        "warn",
        "SANDBOX_TEST_NETWORK=egress : les tests disposent d'un accès réseau " +
          "sortant. Cette option doit rester exceptionnelle.",
      );
    }

    await ctx.log("info", "Exécution des tests dans la sandbox (npm test)...");
    const started = Date.now();
    const result = await session.run({
      command: "npm",
      args: ["test", "--if-present"],
      timeoutMs: config.testTimeoutMs,
      network: config.testNetwork,
      label: "npm test",
    });

    if (result.exitCode !== 0) {
      await ctx.log("error", `Tests échoués (code ${result.exitCode})`);
      const stdout = tail(result.stdout);
      const stderr = tail(result.stderr);
      if (stdout) await ctx.log("error", `[stdout]\n${stdout}`);
      if (stderr) await ctx.log("error", `[stderr]\n${stderr}`);
      return {
        success: false,
        exitCode: result.exitCode,
        error: "Tests échoués",
      };
    }

    await ctx.log(
      "info",
      `Tests réussis en ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    return { success: true, exitCode: 0 };
  } catch (err) {
    return failureResult(ctx, err, "Tests");
  } finally {
    // Plus aucune étape n'a besoin de la sandbox après les tests. La détruire
    // ici libère la RAM/le disque sans attendre la fin du pipeline (build,
    // scans, déploiement). Le nettoyage du moteur reste aussi garanti en
    // `finally` côté pipeline, pour les cas d'arrêt brutal.
    if (session) {
      await session.destroy().catch(() => undefined);
    }
  }
}
