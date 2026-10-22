// apps/worker/src/steps/checkout/checkout.step.ts
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { prisma } from "../../utils/prisma";
import { logger } from "../../utils/logger";
import { redactGithubSecrets } from "../../utils/github-redact";
import { getInstallationToken } from "../../services/github-token.service";
import { getGithubAppConfig } from "../../services/github-config.service";
import { execFileAsync } from "../../orchestrator/step.executor";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import { buildSandboxEnv } from "../../utils/sandbox-env";

const WORKSPACES_ROOT = path.join(os.tmpdir(), "devsecops-workspaces");
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

// ============================================================
// RÃƒâ€°SOLUTION DE L'URL DE CLONE
// ============================================================
interface CloneSource {
  url: string;
  authHeader: string | null;
  kind: "local" | "github-app" | "github-mirror" | "github-public";
}

/**
 * DÃƒÂ©termine l'URL et l'authentification pour cloner un repo.
 *
 * 1. Repo local "local:..."  Ã¢â€ â€™ file://
 * 2. Repo liÃƒÂ© ÃƒÂ  une GitHub App Ã¢â€ â€™ token d'installation
 * 3. Fallback : repo public via miroir ghfast.top
 * 4. Fallback final : GitHub direct
 */
async function resolveCloneSource(
  repoFullName: string,
  projectId: string,
): Promise<CloneSource> {
  // -------- 1. Repo local --------
  if (repoFullName.startsWith("local:")) {
    const localPath = repoFullName.slice("local:".length);
    const normalized = localPath.replace(/\//g, "\\").replace(/\\+/g, "\\");
    return {
      url: `file:///${normalized.replace(/\\/g, "/")}`,
      authHeader: null,
      kind: "local",
    };
  }

  // -------- 2. Repo liÃƒÂ© ÃƒÂ  une GitHub App --------
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      githubRepository: {
        select: {
          installation: {
            select: {
              installationId: true,
              revokedAt: true,
              suspendedAt: true,
            },
          },
        },
      },
    },
  });

  const githubApp = await getGithubAppConfig();

  if (
    githubApp &&
    project?.githubRepository?.installation &&
    !project.githubRepository.installation.revokedAt &&
    !project.githubRepository.installation.suspendedAt
  ) {
    try {
      const token = await getInstallationToken(
        project.githubRepository.installation.installationId,
      );

      // Encodage Basic pour le header Git
      const basicAuth = Buffer.from(`x-access-token:${token}`).toString(
        "base64",
      );

      return {
        url: `https://github.com/${repoFullName}.git`,
        authHeader: `AUTHORIZATION: basic ${basicAuth}`,
        kind: "github-app",
      };
    } catch (err) {
      logger.warn(
        { err, repoFullName },
        "Ãƒâ€°chec gÃƒÂ©nÃƒÂ©ration token installation Ã¢â‚¬â€ fallback vers clone public",
      );
    }
  }

  // -------- 3. Miroir (utile pour rÃƒÂ©seau instable) --------
  const mirrorPrefix = process.env.GIT_MIRROR_PREFIX?.trim() ?? "";
  const raw = `https://github.com/${repoFullName}.git`;

  if (mirrorPrefix) {
    return {
      url: `${mirrorPrefix}${raw}`,
      authHeader: null,
      kind: "github-mirror",
    };
  }

  // -------- 4. GitHub direct --------
  return {
    url: raw,
    authHeader: null,
    kind: "github-public",
  };
}

// ============================================================
// CLONE AVEC RETRY
// ============================================================
interface CloneAttemptResult {
  ok: boolean;
  error?: string;
}

async function tryClone(
  source: CloneSource,
  branch: string,
  target: string,
  timeoutMs: number,
): Promise<CloneAttemptResult> {
  const args: string[] = [];

  // Header d'authentification Git (jamais persistÃƒÂ© sur disque)
  if (source.authHeader) {
    args.push("-c", `http.extraheader=${source.authHeader}`);
  }

  args.push(
    "clone",
    "--depth", "1",
    "--branch", branch,
    "--single-branch",
    "--no-tags",
    source.url,
    target,
  );

  try {
    await execFileAsync("git", args, {
      timeout: timeoutMs,
      // Environnement filtrÃƒÂ© : `git` n'a besoin d'aucun secret de plateforme.
      env: buildSandboxEnv(process.env, {
        GIT_TERMINAL_PROMPT: "0",
        GIT_HTTP_LOW_SPEED_LIMIT: "1000",
        GIT_HTTP_LOW_SPEED_TIME: "60",
      }),
    });
    return { ok: true };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    // Toujours masquer les tokens dans le message d'erreur
    return { ok: false, error: redactGithubSecrets(rawMsg) };
  }
}

// ============================================================
// Ãƒâ€°TAPE CHECKOUT
// ============================================================
export async function checkoutStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", `Workspace : ${ctx.workspaceDir}`);
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });

  const source = await resolveCloneSource(ctx.repoFullName, ctx.projectId);

  switch (source.kind) {
    case "local":
      await ctx.log("info", `Repo local dÃƒÂ©tectÃƒÂ©`);
      break;
    case "github-app":
      await ctx.log(
        "info",
        `Clone via GitHub App (installation authentifiÃƒÂ©e)`,
      );
      break;
    case "github-mirror":
      await ctx.log("info", `Clone via miroir Git`);
      break;
    case "github-public":
      await ctx.log("info", `Clone via GitHub direct (public)`);
      break;
  }

  await ctx.log(
    "info",
    `Clonage de ${ctx.repoFullName} (branche ${ctx.branch}) Ã¢â‚¬â€ profondeur 1`,
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
    const result = await tryClone(
      source,
      ctx.branch,
      ctx.workspaceDir,
      5 * 60_000,
    );
    const duration = Date.now() - start;

    if (result.ok) {
      await ctx.log(
        "info",
        `Clonage rÃƒÂ©ussi en ${duration}ms (tentative ${attempt})`,
      );

      try {
        const { stdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          { cwd: ctx.workspaceDir },
        );
        const headSha = stdout.trim();
        await ctx.log("info", `Commit clonÃƒÂ© : ${headSha}`);

        return {
          success: true,
          exitCode: 0,
          data: {
            workspaceDir: ctx.workspaceDir,
            headSha,
            attempts: attempt,
            cloneDurationMs: duration,
            sourceKind: source.kind,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.log("error", `Impossible de lire le SHA : ${msg}`);
        return { success: false, exitCode: 1, error: msg };
      }
    }

    lastError = result.error ?? "Erreur inconnue";
    const shortError = lastError
      .split("\n")
      .filter(Boolean)
      .slice(-2)
      .join(" | ");
    await ctx.log(
      "warn",
      `Tentative ${attempt} ÃƒÂ©chouÃƒÂ©e (${duration}ms) : ${shortError}`,
    );
  }

  await ctx.log("error", `Ãƒâ€°chec du clonage aprÃƒÂ¨s ${MAX_ATTEMPTS} tentatives`);
  return {
    success: false,
    exitCode: 1,
    error: `Clonage ÃƒÂ©chouÃƒÂ© aprÃƒÂ¨s ${MAX_ATTEMPTS} tentatives : ${lastError
      .split("\n")
      .slice(-2)
      .join(" | ")}`,
  };
}