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
import { isFullGitSha } from "@devsecops/shared";

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
/**
 * Positionne le workspace sur le SHA exact annoncé par le pipeline.
 *
 * Un `git clone --branch` ne garantit pas que HEAD reste le commit de
 * l'événement : la branche peut avoir avancé entre le webhook et le clone.
 * On récupère donc explicitement le commit demandé (même s'il n'est plus la
 * tête de branche), puis on vérifie que HEAD correspond exactement. Sans
 * cette vérification, les scans, le digest et la promotion pourraient porter
 * sur un code différent du SHA affiché.
 */
async function checkoutExactCommit(
  source: CloneSource,
  workspaceDir: string,
  commitSha: string,
  timeoutMs: number,
): Promise<{ ok: boolean; headSha?: string; error?: string }> {
  const env = buildSandboxEnv(process.env, {
    GIT_TERMINAL_PROMPT: "0",
    GIT_HTTP_LOW_SPEED_LIMIT: "1000",
    GIT_HTTP_LOW_SPEED_TIME: "60",
  });

  try {
    // Le commit peut être absent d'un clone superficiel si la branche a
    // avancé. Dans ce cas, on le récupère par SHA.
    try {
      await execFileAsync(
        "git",
        ["cat-file", "-e", `${commitSha}^{commit}`],
        { cwd: workspaceDir },
      );
    } catch {
      const authArgs: string[] = [];
      if (source.authHeader) {
        authArgs.push("-c", `http.extraheader=${source.authHeader}`);
      }
      try {
        await execFileAsync(
          "git",
          [...authArgs, "fetch", "--depth", "1", "origin", commitSha],
          { cwd: workspaceDir, timeout: timeoutMs, env },
        );
      } catch {
        // Certains serveurs refusent le fetch d'un objet non annoncé. On
        // récupère alors l'historique complet pour garantir que le SHA
        // demandé est bien extrait, plutôt que de bâtir la mauvaise tête.
        await execFileAsync(
          "git",
          [...authArgs, "fetch", "--unshallow", "origin"],
          { cwd: workspaceDir, timeout: timeoutMs, env },
        );
      }
    }

    await execFileAsync("git", ["checkout", "--detach", commitSha], {
      cwd: workspaceDir,
    });

    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: workspaceDir,
    });
    const headSha = stdout.trim();
    if (headSha !== commitSha) {
      return {
        ok: false,
        error: `Le commit extrait (${headSha}) ne correspond pas au SHA du pipeline (${commitSha})`,
      };
    }
    return { ok: true, headSha };
  } catch (err) {
    return {
      ok: false,
      error: redactGithubSecrets(
        err instanceof Error ? err.message : String(err),
      ),
    };
  }
}

export async function checkoutStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", `Workspace : ${ctx.workspaceDir}`);

  // Le pipeline doit toujours référencer un SHA Git complet : on refuse un
  // identifiant synthétique ou tronqué, qui rendrait le build intraçable.
  if (!isFullGitSha(ctx.commitSha)) {
    return {
      success: false,
      exitCode: 1,
      error: `SHA de commit invalide (${ctx.commitSha}) : un SHA Git complet est requis`,
    };
  }

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

      // Le clone par branche peut avoir récupéré une tête plus récente que
      // le commit de l'événement : on force le SHA exact avant tout scan.
      const exact = await checkoutExactCommit(
        source,
        ctx.workspaceDir,
        ctx.commitSha,
        5 * 60_000,
      );
      if (!exact.ok) {
        lastError = exact.error ?? "Commit demandé introuvable";
        await ctx.log(
          "warn",
          `Extraction du commit ${ctx.commitSha} échouée : ${lastError}`,
        );
        continue;
      }

      await ctx.log("info", `Commit extrait et vérifié : ${exact.headSha}`);

      return {
        success: true,
        exitCode: 0,
        data: {
          workspaceDir: ctx.workspaceDir,
          headSha: exact.headSha,
          attempts: attempt,
          cloneDurationMs: duration,
          sourceKind: source.kind,
        },
      };
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