// apps/api/src/modules/github/github.controller.ts
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { BadRequestError, UnauthorizedError } from "../../utils/errors";
import { logError } from "../../utils/logger";
import * as appService from "./github-app.service";
import * as installService from "./installations.service";
import * as repoService from "./repositories.service";
import * as branchProtectionService from "./branch-protection.service";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

// ------------------------------------------------------------
// GET /api/github/install/start
// Retourne l'URL d'installation officielle de la GitHub App
// ------------------------------------------------------------
export async function startInstall(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const url = await appService.buildInstallUrl(actor.id);
    res.json({ url });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// GET /api/github/setup/callback
// GitHub redirige ici APRÈS installation réussie (setup_url)
// ------------------------------------------------------------
export async function setupCallback(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const frontendUrl = env.FRONTEND_URL;
  try {
    const { installation_id, setup_action, state } = req.query as {
      installation_id?: string;
      setup_action?: string;
      state?: string;
    };

    if (!installation_id || !state) {
      return res.redirect(
        `${frontendUrl}/repositories?github=error&reason=missing_params`,
      );
    }

    let userId: string;
    try {
      const decoded = await appService.verifyInstallState(state);
      userId = decoded.userId;
    } catch {
      return res.redirect(
        `${frontendUrl}/repositories?github=error&reason=invalid_state`,
      );
    }

    await installService.syncInstallation({
      userId,
      installationId: installation_id,
    });

    const action = setup_action === "update" ? "updated" : "installed";
    return res.redirect(
      `${frontendUrl}/repositories?github=success&action=${action}&installation_id=${installation_id}`,
    );
  } catch (err) {
    logError("GitHub setup callback error", err);
    return res.redirect(
      `${frontendUrl}/repositories?github=error&reason=unknown`,
    );
  }
}

// ------------------------------------------------------------
// GET /api/github/installations
// ------------------------------------------------------------
export async function listInstallations(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const installations = await installService.listInstallations(actor.id);
    res.json({ installations });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// POST /api/github/installations/:id/sync
// ------------------------------------------------------------
export async function syncInstallation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const installationId = req.params.id;

    const owned = await installService.listInstallations(actor.id);
    const found = owned.find(
      (i: { installationId: string }) => i.installationId === installationId,
    );
    if (!found) {
      throw new BadRequestError("Installation inconnue ou non autorisée");
    }

    await installService.syncInstallation({
      userId: actor.id,
      installationId,
    });

    res.status(202).json({ status: "sync_started" });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// DELETE /api/github/installations/:id
// ------------------------------------------------------------
export async function revokeInstallation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    await installService.revokeInstallation(actor.id, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// GET /api/github/repositories
// ------------------------------------------------------------
export async function listRepositories(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const {
      installationId,
      search,
      private: privateParam,
      page,
      pageSize,
    } = req.query as Record<string, string | undefined>;

    const result = await repoService.listUserRepositories(actor.id, {
      installationId,
      search,
      private:
        privateParam === "true"
          ? true
          : privateParam === "false"
            ? false
            : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// GET /api/github/repositories/:id
// ------------------------------------------------------------
export async function getRepository(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const repo = await repoService.getRepositoryForUser(
      actor.id,
      req.params.id,
    );
    res.json({ repository: repo });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// GET /api/github/repositories/:id/branches
// ------------------------------------------------------------
export async function listBranches(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const branches = await repoService.listBranches(actor.id, req.params.id);
    res.json({ branches });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// GET /api/github/repositories/:id/commits
// ------------------------------------------------------------
export async function listCommits(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const { branch } = req.query as { branch?: string };
    const commits = await repoService.listCommits(
      actor.id,
      req.params.id,
      branch,
    );
    res.json({ commits });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// GET /api/github/repositories/:id/branch-protection?branch=...
// Vérifie la protection réelle et les rulesets, sans déduire un
// blocage de fusion du seul Check Run.
// ------------------------------------------------------------
export async function getBranchProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const { branch } = req.query as { branch?: string };
    const report = await branchProtectionService.inspectBranchProtection(
      actor.id,
      req.params.id,
      branch,
    );
    res.json({ branchProtection: report });
  } catch (err) {
    next(err);
  }
}