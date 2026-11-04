// apps/api/src/modules/github/teams.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as teamsService from "./teams.service";
import * as teamReposService from "./team-repos.service";
import * as projectTeamsService from "./project-teams.service";
import type {
  AddMemberBody,
  CreateTeamBody,
  ListMembersQuery,
  ListTeamsQuery,
} from "./teams.schema";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listOrganizations(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const organizations = await teamsService.listOrganizations(actor.id);
    res.json({ organizations });
  } catch (err) {
    next(err);
  }
}

export async function syncOrganization(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await teamsService.syncOrganization(
      actor.id,
      req.params.installationId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listTeams(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const query = req.query as unknown as ListTeamsQuery;
    const result = await teamsService.listTeams(
      actor.id,
      req.params.installationId,
      query,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await teamsService.getTeam(
      actor.id,
      req.params.installationId,
      req.params.slug,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function syncTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await teamsService.syncTeam(
      actor.id,
      req.params.installationId,
      req.params.slug,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function createTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const body = req.body as CreateTeamBody;
    const result = await teamsService.createTeam(
      actor.id,
      req.params.installationId,
      body,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listMembers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const query = req.query as unknown as ListMembersQuery;
    const result = await teamsService.listMembers(
      actor.id,
      req.params.installationId,
      req.params.slug,
      query,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function addMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const body = req.body as AddMemberBody;
    const result = await teamsService.addMember(
      actor.id,
      req.params.installationId,
      req.params.slug,
      body,
    );
    res.status(result.state === "pending" ? 202 : 200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function removeMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await teamsService.removeMember(
      actor.id,
      req.params.installationId,
      req.params.slug,
      req.params.username,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listTeamRepos(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const { page, pageSize } = req.query as unknown as {
      page: number;
      pageSize: number;
    };
    const result = await teamReposService.listTeamRepos(
      actor.id,
      req.params.installationId,
      req.params.slug,
      { page, pageSize },
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listAvailableRepos(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await teamReposService.listAvailableRepos(
      actor.id,
      req.params.installationId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function setRepoPermission(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const { permission } = req.body as {
      permission: teamReposService.TeamRepoPermission;
    };
    const result = await teamReposService.setRepoPermission(
      actor.id,
      req.params.installationId,
      req.params.slug,
      {
        owner: req.params.owner,
        repo: req.params.repo,
        permission,
      },
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function removeTeamRepo(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await teamReposService.removeTeamRepo(
      actor.id,
      req.params.installationId,
      req.params.slug,
      req.params.owner,
      req.params.repo,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// ASSOCIATIONS ÉQUIPE → PROJET (vue équipe)
// ============================================================

export async function listTeamProjects(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await projectTeamsService.listTeamProjects(
      actor,
      req.params.installationId,
      req.params.slug,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function associateTeamProject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const { projectId, role } = req.body as {
      projectId: string;
      role: projectTeamsService.ProjectTeamRoleValue;
    };
    const result = await projectTeamsService.associateTeamToProjectFromTeam(
      actor,
      req.params.installationId,
      req.params.slug,
      projectId,
      role,
    );
    res.status(201).json({ link: result });
  } catch (err) {
    next(err);
  }
}

export async function updateTeamProjectRole(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const { role } = req.body as {
      role: projectTeamsService.ProjectTeamRoleValue;
    };
    const result = await projectTeamsService.updateProjectTeamRoleFromTeam(
      actor,
      req.params.installationId,
      req.params.slug,
      req.params.linkId,
      role,
    );
    res.json({ link: result });
  } catch (err) {
    next(err);
  }
}

export async function removeTeamProject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await projectTeamsService.removeProjectTeamFromTeam(
      actor,
      req.params.installationId,
      req.params.slug,
      req.params.linkId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
