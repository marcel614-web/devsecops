// apps/api/src/modules/github/project-teams.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as projectTeamsService from "./project-teams.service";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listProjectTeams(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await projectTeamsService.listProjectTeams(
      actor,
      req.params.id,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listAvailableTeams(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await projectTeamsService.listAvailableTeams(
      actor,
      req.params.id,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function associateProjectTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const { githubTeamId, role } = req.body as {
      githubTeamId: string;
      role: projectTeamsService.ProjectTeamRoleValue;
    };
    const result = await projectTeamsService.associateTeamToProject(
      actor,
      req.params.id,
      githubTeamId,
      role,
    );
    res.status(201).json({ link: result });
  } catch (err) {
    next(err);
  }
}

export async function updateProjectTeamRole(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const { role } = req.body as {
      role: projectTeamsService.ProjectTeamRoleValue;
    };
    const result = await projectTeamsService.updateProjectTeamRole(
      actor,
      req.params.linkId,
      role,
    );
    res.json({ link: result });
  } catch (err) {
    next(err);
  }
}

export async function removeProjectTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await projectTeamsService.removeProjectTeam(
      actor,
      req.params.linkId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
