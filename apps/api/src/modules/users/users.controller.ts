// apps/api/src/modules/users/users.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import {
  getEffectivePermissionsForUser,
  requirePermission,
} from "../authorization/permission.service";
import { PERMISSIONS } from "../authorization/permissions.constants";
import { isPlatformAdmin } from "../authorization/role-permissions";
import * as usersService from "./users.service";
import type {
  CreateUserInput,
  UpdateUserInput,
  UserActivityQuery,
  UserListQuery,
} from "./users.schema";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listUsers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await usersService.listUsers(
      actor,
      req.query as unknown as UserListQuery,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const user = await usersService.getUserById(actor, req.params.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function createUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const user = await usersService.createUser(
      actor,
      req.body as CreateUserInput,
    );
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

export async function updateUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const user = await usersService.updateUser(
      actor,
      req.params.id,
      req.body as UpdateUserInput,
    );
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function deleteUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const user = await usersService.deleteUser(actor, req.params.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function suspendUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const user = await usersService.suspendUser(actor, req.params.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function reactivateUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const user = await usersService.reactivateUser(actor, req.params.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function revokeSessions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    await usersService.revokeUserSessions(actor, req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function getUserActivity(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await usersService.getUserActivity(
      actor,
      req.params.id,
      req.query as unknown as UserActivityQuery,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getUserPermissions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const projectId =
      typeof req.query.projectId === "string" ? req.query.projectId : undefined;

    if (!isPlatformAdmin(actor.role) && actor.id !== req.params.id) {
      if (!projectId) {
        await requirePermission(actor, PERMISSIONS.PROJECT_MANAGE_MEMBERS);
      } else {
        await requirePermission(actor, PERMISSIONS.PROJECT_MANAGE_MEMBERS, {
          projectId,
        });
      }
    }

    const result = await getEffectivePermissionsForUser(
      req.params.id,
      projectId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
