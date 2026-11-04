// apps/api/src/modules/authorization/authorization.middleware.ts
import type { NextFunction, Request, Response } from "express";
import { SpecialPermission } from "@prisma/client";
import { UnauthorizedError } from "../../utils/errors";
import {
  requirePermission,
  requirePlatformAdmin,
  requireSpecialPermission,
} from "./permission.service";
import type { PermissionValue } from "./permissions.constants";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

/** Permission globale (hors projet). */
export function requireGlobalPermission(required: PermissionValue) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await requirePermission(actorFrom(req), required);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Réservé au rôle global PLATFORM_ADMIN. */
export function requirePlatformAdminMiddleware() {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await requirePlatformAdmin(actorFrom(req));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Permission liée à un projet identifié dans l'URL.
 * Le service appelé refait la vérification : ce middleware est une défense
 * supplémentaire, jamais la seule barrière.
 */
export function requireProjectPermission(
  required: PermissionValue,
  projectIdParam = "projectId",
) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const projectId = req.params[projectIdParam];
      if (!projectId) {
        throw new UnauthorizedError("Identifiant de projet manquant");
      }
      await requirePermission(actorFrom(req), required, { projectId });
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Permission spéciale globale ou liée à un projet. */
export function requireSpecialPermissionMiddleware(
  special: SpecialPermission,
  projectIdParam?: string,
) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const projectId = projectIdParam
        ? req.params[projectIdParam]
        : undefined;
      await requireSpecialPermission(actorFrom(req), special, projectId);
      next();
    } catch (err) {
      next(err);
    }
  };
}
