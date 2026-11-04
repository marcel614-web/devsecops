// apps/api/src/modules/users/users.service.ts
import argon2 from "argon2";
import {
  Prisma,
  ProjectMemberStatus,
  Role,
  UserStatus,
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../utils/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { writeAuditLog } from "../authorization/authorization.audit";
import { requirePlatformAdmin } from "../authorization/permission.service";
import { normalizeGlobalRole } from "../authorization/role-permissions";
import type {
  CreateUserInput,
  UpdateUserInput,
  UserActivityQuery,
  UserListQuery,
} from "./users.schema";

const argonOptions = {
  type: argon2.argon2id,
  memoryCost: env.ARGON2_MEMORY_COST,
  timeCost: env.ARGON2_TIME_COST,
  parallelism: env.ARGON2_PARALLELISM,
};

const PUBLIC_SELECT = {
  id: true,
  email: true,
  username: true,
  name: true,
  role: true,
  status: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      projectMemberships: {
        where: { status: ProjectMemberStatus.ACTIVE },
      },
    },
  },
} satisfies Prisma.UserSelect;

export interface ActorContext {
  id: string;
  role: Role;
}

function normalizedRole(role: Role): Role {
  return normalizeGlobalRole(role) === "PLATFORM_ADMIN"
    ? Role.PLATFORM_ADMIN
    : Role.PLATFORM_USER;
}

function isAdminRole(role: Role): boolean {
  return normalizeGlobalRole(role) === "PLATFORM_ADMIN";
}

async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
  return prisma.user.count({
    where: {
      id: { not: excludeUserId },
      status: UserStatus.ACTIVE,
      role: { in: [Role.PLATFORM_ADMIN, Role.ADMIN] },
    },
  });
}

async function assertNotLastAdmin(userId: string): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!target || !isAdminRole(target.role)) return;
  const others = await countOtherActiveAdmins(userId);
  if (others === 0) {
    throw new ConflictError(
      "Impossible de retirer le dernier administrateur de la plateforme",
    );
  }
}

/**
 * Isolation :
 *  - PLATFORM_ADMIN : peut lister/gérer tous les comptes ;
 *  - tout autre rôle : lecture de son propre profil uniquement.
 */
export async function listUsers(actor: ActorContext, query: UserListQuery) {
  await requirePlatformAdmin(actor);

  const where: Prisma.UserWhereInput = {};
  if (query.role) {
    where.role =
      normalizeGlobalRole(query.role) === "PLATFORM_ADMIN"
        ? { in: [Role.PLATFORM_ADMIN, Role.ADMIN] }
        : { in: [Role.PLATFORM_USER, Role.DEVELOPER] };
  }
  if (query.status) where.status = query.status;
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.search) {
    where.OR = [
      { email: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
      { username: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: PUBLIC_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export async function getUserById(actor: ActorContext, userId: string) {
  if (!isAdminRole(actor.role) && actor.id !== userId) {
    throw new ForbiddenError("Accès interdit à cet utilisateur");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: PUBLIC_SELECT,
  });
  if (!user) throw new NotFoundError("Utilisateur introuvable");
  return user;
}

export async function createUser(actor: ActorContext, input: CreateUserInput) {
  await requirePlatformAdmin(actor);

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw new ConflictError("Cet email est déjà utilisé");

  if (input.username) {
    const existingUsername = await prisma.user.findUnique({
      where: { username: input.username },
      select: { id: true },
    });
    if (existingUsername) throw new ConflictError("Ce nom d'utilisateur est déjà utilisé");
  }

  const passwordHash = await argon2.hash(input.password, argonOptions);
  const role = normalizedRole(input.role);
  const status = input.status;

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      username: input.username ?? null,
      passwordHash,
      role,
      status,
      isActive: status === UserStatus.ACTIVE,
    },
    select: PUBLIC_SELECT,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "USER_CREATED_BY_ADMIN",
    targetType: "User",
    targetId: user.id,
    metadata: { role, status },
  });

  return user;
}

export async function updateUser(
  actor: ActorContext,
  userId: string,
  input: UpdateUserInput,
) {
  await requirePlatformAdmin(actor);

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, status: true },
  });
  if (!target) throw new NotFoundError("Utilisateur introuvable");

  const nextRole = input.role ? normalizedRole(input.role) : undefined;
  const nextStatus =
    input.status ??
    (input.isActive === undefined
      ? undefined
      : input.isActive
        ? UserStatus.ACTIVE
        : UserStatus.SUSPENDED);

  // Un administrateur ne peut pas se retirer ses propres droits ni se
  // suspendre lui-même : cela évite un verrouillage accidentel.
  if (actor.id === userId) {
    if (nextRole !== undefined && nextRole !== Role.PLATFORM_ADMIN) {
      throw new ForbiddenError(
        "Impossible de retirer votre propre rôle administrateur",
      );
    }
    if (nextStatus !== undefined && nextStatus !== UserStatus.ACTIVE) {
      throw new ForbiddenError("Impossible de suspendre votre propre compte");
    }
  }

  const removesAdmin =
    isAdminRole(target.role) &&
    ((nextRole !== undefined && nextRole !== Role.PLATFORM_ADMIN) ||
      (nextStatus !== undefined && nextStatus !== UserStatus.ACTIVE));
  if (removesAdmin) {
    await assertNotLastAdmin(userId);
  }

  if (input.email) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictError("Cet email est déjà utilisé");
    }
  }
  if (input.username) {
    const existing = await prisma.user.findUnique({
      where: { username: input.username },
      select: { id: true },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictError("Ce nom d'utilisateur est déjà utilisé");
    }
  }

  const sensitiveChange =
    (nextRole !== undefined && nextRole !== target.role) ||
    (nextStatus !== undefined && nextStatus !== target.status) ||
    input.password !== undefined;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(input.password !== undefined
        ? { passwordHash: await argon2.hash(input.password, argonOptions) }
        : {}),
      ...(nextRole !== undefined ? { role: nextRole } : {}),
      ...(nextStatus !== undefined
        ? {
            status: nextStatus,
            isActive: nextStatus === UserStatus.ACTIVE,
          }
        : {}),
      ...(sensitiveChange ? { tokenVersion: { increment: 1 } } : {}),
    },
    select: PUBLIC_SELECT,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "USER_UPDATED_BY_ADMIN",
    targetType: "User",
    targetId: updated.id,
    metadata: {
      // Aucun mot de passe, hash ou jeton dans l'audit.
      changedFields: Object.keys(input).filter((key) => key !== "password"),
      role: updated.role,
      status: updated.status,
    },
  });

  return updated;
}

export async function deleteUser(actor: ActorContext, userId: string) {
  await requirePlatformAdmin(actor);
  if (actor.id === userId) {
    throw new ForbiddenError("Impossible de supprimer votre propre compte");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  });
  if (!target) throw new NotFoundError("Utilisateur introuvable");
  if (isAdminRole(target.role)) await assertNotLastAdmin(userId);

  // Suppression logique : les projets, pipelines et audits sont conservés.
  await prisma.user.update({
    where: { id: userId },
    data: {
      status: UserStatus.DISABLED,
      isActive: false,
      tokenVersion: { increment: 1 },
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "USER_DELETED_BY_ADMIN",
    targetType: "User",
    targetId: target.id,
    metadata: { email: target.email, mode: "SOFT_DELETE" },
  });

  return { id: target.id, email: target.email };
}

export async function suspendUser(actor: ActorContext, userId: string) {
  await requirePlatformAdmin(actor);
  if (actor.id === userId) {
    throw new ForbiddenError("Impossible de suspendre votre propre compte");
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!target) throw new NotFoundError("Utilisateur introuvable");
  if (isAdminRole(target.role)) await assertNotLastAdmin(userId);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      status: UserStatus.SUSPENDED,
      isActive: false,
      tokenVersion: { increment: 1 },
    },
    select: PUBLIC_SELECT,
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "USER_SUSPENDED",
    targetType: "User",
    targetId: userId,
  });
  return updated;
}

export async function reactivateUser(actor: ActorContext, userId: string) {
  await requirePlatformAdmin(actor);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      status: UserStatus.ACTIVE,
      isActive: true,
      tokenVersion: { increment: 1 },
    },
    select: PUBLIC_SELECT,
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "USER_REACTIVATED",
    targetType: "User",
    targetId: userId,
  });
  return updated;
}

export async function revokeUserSessions(actor: ActorContext, userId: string) {
  await requirePlatformAdmin(actor);
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!target) throw new NotFoundError("Utilisateur introuvable");

  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "USER_SESSIONS_REVOKED",
    targetType: "User",
    targetId: userId,
  });
}

export async function getUserActivity(
  actor: ActorContext,
  userId: string,
  query: UserActivityQuery,
) {
  await requirePlatformAdmin(actor);
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!target) throw new NotFoundError("Utilisateur introuvable");

  const where: Prisma.AuditLogWhereInput = {
    OR: [{ userId }, { targetId: userId, targetType: "User" }],
  };
  const skip = (query.page - 1) * query.pageSize;
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}
