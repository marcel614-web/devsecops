// apps/api/src/middleware/rbac.ts
import type { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthorizedError } from "../utils/errors";
import type { AuthUser } from "./auth";
import { normalizeGlobalRole } from "../modules/authorization/role-permissions";

type Role = AuthUser["role"];

/**
 * Compatibilité avec les routes historiques. Les nouveaux contrôles doivent
 * utiliser `requireGlobalPermission` / `requireProjectPermission`.
 * Les anciennes valeurs ADMIN/DEVELOPER sont normalisées.
 */
export function requireRole(...allowed: Role[]) {
  const normalized = new Set(allowed.map((role) => normalizeGlobalRole(role)));
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    if (!normalized.has(normalizeGlobalRole(req.user.role))) {
      return next(new ForbiddenError("Rôle insuffisant pour cette action"));
    }
    next();
  };
}