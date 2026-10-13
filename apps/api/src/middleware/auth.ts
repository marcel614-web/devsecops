// apps/api/src/middleware/auth.ts
import type { NextFunction, Request, Response } from "express";
import { ACCESS_COOKIE_NAME } from "../config/constants";
import { UnauthorizedError } from "../utils/errors";
import { verifyAccessToken } from "../utils/jwt";

/**
 * Utilisateur authentifié attaché à la requête.
 * On ne stocke QUE le minimum nécessaire.
 */
export interface AuthUser {
  id: string;
  role: "ADMIN" | "DEVELOPER";
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

/**
 * Middleware d'authentification obligatoire.
 */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = extractToken(req);
  if (!token) {
    return next(new UnauthorizedError("Token d'authentification manquant"));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      role: payload.role as AuthUser["role"],
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware d'authentification optionnelle.
 * Utilisable sur des routes publiques mais enrichies si un token est présent.
 */
export function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      role: payload.role as AuthUser["role"],
    };
  } catch {
    // Token invalide → on ignore et on continue en anonyme.
  }
  next();
}