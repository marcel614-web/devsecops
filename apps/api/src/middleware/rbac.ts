// apps/api/src/middleware/rbac.ts
import type { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthorizedError } from "../utils/errors";
import type { AuthUser } from "./auth";

type Role = AuthUser["role"];

/**
 * Middleware d'autorisation par rôle.
 * À utiliser APRÈS requireAuth.
 * 
 * Exemple : router.post("/", requireAuth, requireRole("ADMIN"), handler)
 *           router.get("/", requireAuth, requireRole("ADMIN", "DEVELOPER"), handler)
 */
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    if (!allowed.includes(req.user.role)) {
      return next(new ForbiddenError("Rôle insuffisant pour cette action"));
    }
    next();
  };
}