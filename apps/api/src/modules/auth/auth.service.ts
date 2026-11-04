// apps/api/src/modules/auth/auth.service.ts
import crypto from "node:crypto";
import argon2 from "argon2";
import { Role, UserStatus } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../utils/prisma";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/errors";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwt";
import { logWarn } from "../../utils/logger";
import { getEffectivePermissions } from "../authorization/permission.service";
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from "./auth.schema";

const argonOptions = {
  type: argon2.argon2id,
  memoryCost: env.ARGON2_MEMORY_COST,
  timeCost: env.ARGON2_TIME_COST,
  parallelism: env.ARGON2_PARALLELISM,
};

/**
 * Hash bidon utilisé pour normaliser le temps de réponse quand l'utilisateur
 * n'existe pas. Empêche le timing attack sur la présence d'un email.
 */
let dummyHashPromise: Promise<string> | null = null;
async function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash("dummy-password-for-timing", argonOptions);
  }
  return dummyHashPromise;
}

export interface AuthUserPublic {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  /** Permissions globales effectives (hors projet), pour adapter la navigation. */
  globalPermissions: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: AuthUserPublic;
  tokens: AuthTokens;
}

/**
 * Résultat d'une inscription : le compte créé est **inactif** (validation
 * par un administrateur requise), donc AUCUN jeton n'est délivré.
 */
export interface RegisterResult {
  user: AuthUserPublic;
  isActive: false;
  tokens: null;
}

interface AuditContext {
  ip?: string;
  userAgent?: string;
}

function buildTokens(
  userId: string,
  role: Role,
  tokenVersion: number,
): AuthTokens {
  const jti = crypto.randomUUID();
  return {
    accessToken: signAccessToken({ sub: userId, role, tv: tokenVersion }),
    refreshToken: signRefreshToken({ sub: userId, jti }),
  };
}

function toPublicUser(
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    status: UserStatus;
    lastLoginAt: Date | null;
    createdAt: Date;
  },
  globalPermissions: string[] = [],
): AuthUserPublic {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    globalPermissions,
  };
}

async function writeAudit(input: {
  userId: string;
  action: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });
  } catch (err) {
    // L'audit ne doit JAMAIS faire échouer une action métier.
    logWarn("Échec d'écriture du log d'audit", {
      action: input.action,
      userId: input.userId,
    });
  }
}

export async function registerUser(
  input: RegisterInput,
  ctx: AuditContext = {},
): Promise<RegisterResult> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError("Un compte existe déjà avec cet email");
  }

  const passwordHash = await argon2.hash(input.password, argonOptions);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash,
      role: Role.PLATFORM_USER,
      status: UserStatus.PENDING,
      isActive: false,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  await writeAudit({
    userId: user.id,
    action: "USER_REGISTERED",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  // Le compte est inactif : on ne délivre AUCUN jeton. Historiquement, un
  // access token valide était renvoyé pour un compte jamais activé, ce qui
  // constituait un contournement de l'activation (requireAuth ne revérifie
  // pas isActive). L'utilisateur doit être activé par un administrateur.
  return {
    user: toPublicUser(user),
    isActive: false,
    tokens: null,
  };
}

export async function loginUser(
  input: LoginInput,
  ctx: AuditContext = {},
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (!user) {
    // Comparaison factice pour uniformiser le temps de réponse.
    const dummy = await getDummyHash();
    await argon2.verify(dummy, input.password).catch(() => undefined);
    throw new UnauthorizedError("Email ou mot de passe incorrect");
  }

  if (!user.isActive || user.status !== UserStatus.ACTIVE) {
    throw new UnauthorizedError("Ce compte est désactivé");
  }

  const valid = await argon2.verify(user.passwordHash, input.password);
  if (!valid) {
    await writeAudit({
      userId: user.id,
      action: "LOGIN_FAILED",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    throw new UnauthorizedError("Email ou mot de passe incorrect");
  }

  const loggedInAt = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: loggedInAt },
  });

  await writeAudit({
    userId: user.id,
    action: "LOGIN_SUCCESS",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  const globalPermissions = [
    ...(await getEffectivePermissions(
      { id: user.id, role: user.role, status: user.status },
      null,
    )),
  ].sort();

  return {
    user: toPublicUser(
      { ...user, lastLoginAt: loggedInAt },
      globalPermissions,
    ),
    tokens: buildTokens(user.id, user.role, user.tokenVersion),
  };
}

export async function refreshSession(refreshToken: string): Promise<AuthTokens> {
  const payload = verifyRefreshToken(refreshToken);

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, status: true, isActive: true, tokenVersion: true },
  });
  if (!user || !user.isActive || user.status !== UserStatus.ACTIVE) {
    throw new UnauthorizedError();
  }

  // Rotation : nouveau jti à chaque refresh. La version de session est
  // réincluse pour que les jetons révoqués restent invalides.
  return buildTokens(user.id, user.role, user.tokenVersion);
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!user) throw new NotFoundError("Utilisateur introuvable");
  const globalPermissions = [
    ...(await getEffectivePermissions(
      { id: user.id, role: user.role, status: user.status },
      null,
    )),
  ].sort();
  return { ...user, globalPermissions };
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
) {
  if (input.email) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictError("Cet email est déjà utilisé");
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      lastLoginAt: true,
      updatedAt: true,
    },
  });

  await writeAudit({ userId, action: "PROFILE_UPDATED" });
  return updated;
}

/**
 * Révoque toutes les sessions de l'utilisateur courant en incrémentant
 * `tokenVersion`. Le jeton d'accès utilisé pour cet appel devient donc
 * immédiatement invalide, ainsi que tous les refresh tokens existants.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw new NotFoundError("Utilisateur introuvable");

  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });

  await writeAudit({ userId, action: "USER_SESSIONS_REVOKED" });
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("Utilisateur introuvable");

  const valid = await argon2.verify(user.passwordHash, input.currentPassword);
  if (!valid) {
    throw new UnauthorizedError("Mot de passe actuel incorrect");
  }

  const newHash = await argon2.hash(input.newPassword, argonOptions);
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: newHash,
      // Toutes les sessions existantes sont invalidées après un changement
      // de mot de passe.
      tokenVersion: { increment: 1 },
    },
  });

  await writeAudit({ userId, action: "PASSWORD_CHANGED" });
}