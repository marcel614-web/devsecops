// apps/api/src/modules/projects/project-members.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as service from "./project-members.service";
import type {
  AcceptInvitationInput,
  GrantSpecialPermissionInput,
  InviteProjectMemberInput,
  UpdateProjectMemberRoleInput,
} from "./project-members.schema";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listMembers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const members = await service.listProjectMembers(actorFrom(req), req.params.id);
    res.json({ members });
  } catch (err) {
    next(err);
  }
}

export async function listInvitations(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invitations = await service.listProjectInvitations(
      actorFrom(req),
      req.params.id,
    );
    res.json({ invitations });
  } catch (err) {
    next(err);
  }
}

export async function inviteMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.inviteProjectMember(
      actorFrom(req),
      req.params.id,
      req.body as InviteProjectMemberInput,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function resendInvitation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.resendProjectInvitation(
      actorFrom(req),
      req.params.id,
      req.params.invitationId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function revokeInvitation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await service.revokeProjectInvitation(
      actorFrom(req),
      req.params.id,
      req.params.invitationId,
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function acceptInvitation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const member = await service.acceptProjectInvitation(
      actorFrom(req),
      req.body as AcceptInvitationInput,
    );
    res.json({ member });
  } catch (err) {
    next(err);
  }
}

export async function updateMemberRole(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const member = await service.updateProjectMemberRole(
      actorFrom(req),
      req.params.id,
      req.params.memberId,
      req.body as UpdateProjectMemberRoleInput,
    );
    res.json({ member });
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
    await service.removeProjectMember(
      actorFrom(req),
      req.params.id,
      req.params.memberId,
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function listPermissionGrants(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const grants = await service.listProjectPermissionGrants(
      actorFrom(req),
      req.params.id,
    );
    res.json({ grants });
  } catch (err) {
    next(err);
  }
}

export async function grantPermission(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const grant = await service.grantSpecialPermission(
      actorFrom(req),
      req.params.id,
      req.body as GrantSpecialPermissionInput,
    );
    res.status(201).json({ grant });
  } catch (err) {
    next(err);
  }
}

export async function revokePermission(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await service.revokeSpecialPermission(
      actorFrom(req),
      req.params.id,
      req.params.grantId,
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function getMemberPermissions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.getMemberEffectivePermissions(
      actorFrom(req),
      req.params.id,
      req.params.memberId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listGlobalPermissionGrants(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const grants = await service.listGlobalPermissionGrants(actorFrom(req));
    res.json({ grants });
  } catch (err) {
    next(err);
  }
}

export async function grantGlobalPermission(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const grant = await service.grantGlobalSpecialPermission(
      actorFrom(req),
      req.body as GrantSpecialPermissionInput,
    );
    res.status(201).json({ grant });
  } catch (err) {
    next(err);
  }
}

export async function revokeGlobalPermission(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await service.revokeGlobalSpecialPermission(
      actorFrom(req),
      req.params.grantId,
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
