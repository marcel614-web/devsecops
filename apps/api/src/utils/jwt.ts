// apps/api/src/utils/jwt.ts
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import { JWT_AUDIENCE, JWT_ISSUER } from "../config/constants";
import { UnauthorizedError } from "./errors";

export interface AccessTokenPayload {
  sub: string;      // userId
  role: string;     // PLATFORM_ADMIN / PLATFORM_USER
  /** Version de session : rejetée si elle ne correspond plus au compte. */
  tv?: number;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;      // identifiant unique du refresh token (rotation)
  type: "refresh";
}

const BASE_OPTIONS: SignOptions = {
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
  algorithm: "HS256",
};

export function signAccessToken(payload: Omit<AccessTokenPayload, "type">): string {
  return jwt.sign(
    { ...payload, type: "access" },
    env.JWT_ACCESS_SECRET,
    { ...BASE_OPTIONS, expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"] },
  );
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, "type">): string {
  return jwt.sign(
    { ...payload, type: "refresh" },
    env.JWT_REFRESH_SECRET,
    { ...BASE_OPTIONS, expiresIn: env.JWT_REFRESH_TTL as SignOptions["expiresIn"] },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ["HS256"],
    }) as AccessTokenPayload;

    if (decoded.type !== "access") {
      throw new UnauthorizedError("Type de token invalide");
    }
    return decoded;
  } catch {
    // On ne distingue jamais "expiré" de "invalide" côté client.
    throw new UnauthorizedError("Token d'accès invalide ou expiré");
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ["HS256"],
    }) as RefreshTokenPayload;

    if (decoded.type !== "refresh") {
      throw new UnauthorizedError("Type de token invalide");
    }
    return decoded;
  } catch {
    throw new UnauthorizedError("Refresh token invalide ou expiré");
  }
}