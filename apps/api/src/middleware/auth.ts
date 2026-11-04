// apps/api/src/middleware/auth.ts
import type { NextFunction, Request, Response } from "express";
import { Role, UserStatus } from "@prisma/client";
import { ACCESS_COOKIE_NAME } from "../config/constants";
import { prisma } from "../utils/prisma";
import { UnauthorizedError } from "../utils/errors";
import { verifyAccessToken } from "../utils/jwt";
import { normalizeGlobalRole } from "../modules/authorization/role-permissions";

/**
 * Utilisateur authentifié attaché à la requête.
 * Le rôle est relu en base à chaque requête : un JWT ancien ne peut pas
 * conserver un rôle révoqué, et un compte suspendu est immédiatement bloqué.
 */
export interface AuthUser {
  id: string;
  role: Role;
  status: UserStatus;
  tokenVersion: number;
}

// Extension du type Request d'Express
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Extrait le token depuis :
 *  1. le header "Authorization: Bearer xxx"
 *  2. le cookie httpOnly (fallback navigateur)
 */
function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  const cookieToken = req.cookies?.[ACCESS_COOKIE_NAME];
  if (typeof cookieToken === "string" && cookieToken.length > 0) {
    return cookieToken;
  }
  return null;
}

async function resolveAuthenticatedUser(token: string): Promise<AuthUser> {
  const payload = verifyAccessToken(token);
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      role: true,
      status: true,
      isActive: true,
      tokenVersion: true,
    },
  });

  if (!user || !user.isActive || user.status !== UserStatus.ACTIVE) {
    throw new UnauthorizedError("Ce compte n'est pas actif");
  }

  // Les anciens jetons sans `tv` sont acceptés comme version 0, ce qui
  // préserve la compatibilité pendant la migration.
  if ((payload.tv ?? 0) !== user.tokenVersion) {
    throw new UnauthorizedError("Session expirée, veuillez vous reconnecter");
  }

  return {
    id: user.id,
    role: normalizeGlobalRole(user.role) as Role,
    status: user.status,
    tokenVersion: user.tokenVersion,
  };
}

/**
 * Middleware d'authentification obligatoire.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    return next(new UnauthorizedError("Token d'authentification manquant"));
  }

  try {
    req.user = await resolveAuthenticatedUser(token);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware d'authentification optionnelle.
 * Utilisable sur des routes publiques mais enrichies si un token est présent.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractToken(req);
  if (!token) return next();

  try {
    req.user = await resolveAuthenticatedUser(token);
  } catch {
    // Token invalide/suspendu → on continue en anonyme.
  }
  next();
}
