// apps/api/src/modules/projects/projects.controller.ts
import type { NextFunction, Request, Response } from "express";
import { BadRequestError, UnauthorizedError } from "../../utils/errors";
import * as projectsService from "./projects.service";
import * as repoService from "../github/repositories.service";
import type {
  CreateGateExceptionInput,
  CreateProjectInput,
  GateExceptionDecisionInput,
  ProjectListQuery,
  UpdateProjectConfigInput,
  UpdateProjectInput,
} from "./projects.schema";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listProjects(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await projectsService.listProjects(
      actor,
      req.query as unknown as ProjectListQuery,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getProject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const project = await projectsService.getProject(actor, req.params.id);
    res.json({ project });
  } catch (err) {
    next(err);
  }
}

export async function createProject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const project = await projectsService.createProject(
      actor,
      req.body as CreateProjectInput,
    );
    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
}

export async function updateProject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const project = await projectsService.updateProject(
      actor,
      req.params.id,
      req.body as UpdateProjectInput,
    );
    res.json({ project });
  } catch (err) {
    next(err);
  }
}

export async function deleteProject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    await projectsService.deleteProject(actor, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function getProjectConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const config = await projectsService.getProjectConfig(actor, req.params.id);
    res.json({ config });
  } catch (err) {
    next(err);
  }
}

export async function updateProjectConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const config = await projectsService.updateProjectConfig(
      actor,
      req.params.id,
      req.body as UpdateProjectConfigInput,
    );
    res.json({ config });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// GET /api/projects/:id/gate-exceptions
// POST /api/projects/:id/gate-exceptions
// DELETE /api/projects/:id/gate-exceptions/:exceptionId
// ------------------------------------------------------------
export async function listGateExceptions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const exceptions = await projectsService.listGateExceptions(
      actor,
      req.params.id,
    );
    res.json({ exceptions });
  } catch (err) {
    next(err);
  }
}

export async function createGateException(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const exception = await projectsService.createGateException(
      actor,
      req.params.id,
      req.body as CreateGateExceptionInput,
    );
    res.status(201).json({ exception });
  } catch (err) {
    next(err);
  }
}

export async function getGateException(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const exception = await projectsService.getGateException(
      actor,
      req.params.id,
      req.params.exceptionId,
    );
    res.json({ exception });
  } catch (err) {
    next(err);
  }
}

export async function decideGateException(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const body = req.body as GateExceptionDecisionInput;
    const exception = await projectsService.decideGateException(
      actor,
      req.params.id,
      req.params.exceptionId,
      body.decision,
      body.comment,
    );
    res.json({ exception });
  } catch (err) {
    next(err);
  }
}

export async function deleteGateException(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    await projectsService.deleteGateException(
      actor,
      req.params.id,
      req.params.exceptionId,
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// POST /api/projects/:id/repository
// ------------------------------------------------------------
export async function associateRepository(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const { repositoryId, branch } = req.body as {
      repositoryId?: string;
      branch?: string;
    };

    if (!repositoryId || !branch) {
      throw new BadRequestError("repositoryId et branch sont requis");
    }

    const project = await repoService.associateRepositoryToProject(
      actor.id,
      req.params.id,
      repositoryId,
      branch,
    );

    res.json({ project });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// DELETE /api/projects/:id/repository
// ------------------------------------------------------------
export async function detachRepository(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    await repoService.detachRepositoryFromProject(actor.id, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}