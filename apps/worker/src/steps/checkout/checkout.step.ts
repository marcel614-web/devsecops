// apps/worker/src/steps/checkout/checkout.step.ts
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { execFileAsync } from "../../orchestrator/step.executor";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

const WORKSPACES_ROOT = path.join(os.tmpdir(), "devsecops-workspaces");
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

/**
 * Résout l'URL de clonage :
 *  - "local:CHEMIN" → file:///CHEMIN (repo git local)
 *  - sinon → GitHub avec préfixe miroir optionnel (GIT_MIRROR_PREFIX)
 */
function resolveRepoUrl(repoFullName: string): {
  url: string;
  kind: "local" | "mirror" | "github";
} {
  if (repoFullName.startsWith("local:")) {
    const localPath = repoFullName.slice("local:".length);
    const normalized = localPath.replace(/\//g, "\\").replace(/\\+/g, "\\");
    return {
      url: `file:///${normalized.replace(/\\/g, "/")}`,
      kind: "local",
    };
  }

  const raw = `https://github.com/${repoFullName}.git`;
  const mirrorPrefix = process.env.GIT_MIRROR_PREFIX?.trim() ?? "";
  if (mirrorPrefix) {
    return { url: `${mirrorPrefix}${raw}`, kind: "mirror" };
  }
  return { url: raw, kind: "github" };
}

async function tryClone(
  url: string,
  branch: string,
  target: string,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await execFileAsync(
      "git",
      [
        "clone",
        "--depth", "1",
        "--branch", branch,
        "--single-branch",
        "--no-tags",
        url,
        target,
      ],
      {
        timeout: timeoutMs,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_HTTP_LOW_SPEED_LIMIT: "1000",
          GIT_HTTP_LOW_SPEED_TIME: "60",
        },
      },
    );
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function checkoutStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", `Workspace : ${ctx.workspaceDir}`);
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });

  const { url, kind } = resolveRepoUrl(ctx.repoFullName);

  if (kind === "local") {
    await ctx.log("info", `Repo local détecté : ${url}`);
  } else if (kind === "mirror") {
    await ctx.log("info", `Miroir utilisé : ${url}`);
  } else {
    await ctx.log("info", `Source : GitHub direct`);
  }

  await ctx.log(
    "info",
    `Clonage de ${ctx.repoFullName} (branche ${ctx.branch}) — profondeur 1`,
  );

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await fs.rm(ctx.workspaceDir, { recursive: true, force: true });

    if (attempt > 1) {
      await ctx.log(
        "warn",
        `Nouvelle tentative ${attempt}/${MAX_ATTEMPTS} dans ${RETRY_DELAY_MS / 1000}s...`,
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }

    const start = Date.now();
    const result = await tryClone(url, ctx.branch, ctx.workspaceDir, 5 * 60_000);
    const duration = Date.now() - start;

    if (result.ok) {
      await ctx.log(
        "info",
        `Clonage réussi en ${duration}ms (tentative ${attempt})`,
      );

      try {
        const { stdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          { cwd: ctx.workspaceDir },
        );
        const headSha = stdout.trim();
        await ctx.log("info", `Commit cloné : ${headSha}`);

        return {
          success: true,
          exitCode: 0,
          data: {
            workspaceDir: ctx.workspaceDir,
            headSha,
            attempts: attempt,
            cloneDurationMs: duration,
            sourceKind: kind,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.log("error", `Impossible de lire le SHA : ${msg}`);
        return { success: false, exitCode: 1, error: msg };
      }
    }

    lastError = result.error;
    const shortError = lastError
      .split("\n")
      .filter(Boolean)
      .slice(-2)
      .join(" | ");
    await ctx.log(
      "warn",
      `Tentative ${attempt} échouée (${duration}ms) : ${shortError}`,
    );
  }

  await ctx.log("error", `Échec du clonage après ${MAX_ATTEMPTS} tentatives`);
  return {
    success: false,
    exitCode: 1,
    error: `Clonage échoué après ${MAX_ATTEMPTS} tentatives : ${lastError
      .split("\n")
      .slice(-2)
      .join(" | ")}`,
  };
}