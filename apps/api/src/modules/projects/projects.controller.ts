// apps/api/src/modules/projects/projects.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as projectsService from "./projects.service";
import type {
  CreateProjectInput,
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