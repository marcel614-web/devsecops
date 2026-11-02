// apps/api/src/modules/users/users.service.ts
import argon2 from "argon2";
import { Prisma, Role } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../utils/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import type {
  CreateUserInput,
  UpdateUserInput,
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
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export interface ActorContext {
  id: string;
  role: Role;
}

/**
 * Règle d'isolation :
 *  - ADMIN : peut lister / gérer tout le monde.
 *  - DEVELOPER : peut UNIQUEMENT lire son propre profil.
 *    (La mise à jour de son propre profil passe par /api/auth/me.)
 */
export async function listUsers(actor: ActorContext, query: UserListQuery) {
  if (actor.role !== Role.ADMIN) {
    throw new ForbiddenError("Seul un administrateur peut lister les utilisateurs");
  }

  const where: Prisma.UserWhereInput = {};
  if (query.role) where.role = query.role;
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.search) {
    where.OR = [
      { email: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
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
  // Un DEVELOPER ne peut lire que lui-même.
  if (actor.role !== Role.ADMIN && actor.id !== userId) {
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
  if (actor.role !== Role.ADMIN) {
    throw new ForbiddenError("Seul un administrateur peut créer un utilisateur");
  }

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw new ConflictError("Cet email est déjà utilisé");

  const passwordHash = await argon2.hash(input.password, argonOptions);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role,
    },
    select: PUBLIC_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "USER_CREATED_BY_ADMIN",
      targetType: "User",
      targetId: user.id,
    },
  });

  return user;
}

export async function updateUser(
  actor: ActorContext,
  userId: string,
  input: UpdateUserInput,
) {
  if (actor.role !== Role.ADMIN) {
    throw new ForbiddenError("Seul un administrateur peut modifier un utilisateur");
  }

  // Empêche un admin de se retirer lui-même son rôle ADMIN.
  if (actor.id === userId && input.role && input.role !== Role.ADMIN) {
    throw new ForbiddenError("Impossible de retirer votre propre rôle ADMIN");
  }

  // Empêche un admin de se désactiver lui-même.
  if (actor.id === userId && input.isActive === false) {
    throw new ForbiddenError("Impossible de désactiver votre propre compte");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!target) throw new NotFoundError("Utilisateur introuvable");

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
      ...(input.password !== undefined ? { passwordHash: await argon2.hash(input.password, argonOptions) } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: PUBLIC_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "USER_UPDATED_BY_ADMIN",
      targetType: "User",
      targetId: updated.id,
      metadataJson: input as Prisma.InputJsonValue,
    },
  });

  return updated;
}

export async function deleteUser(actor: ActorContext, userId: string) {
  if (actor.role !== Role.ADMIN) {
    throw new ForbiddenError("Seul un administrateur peut supprimer un utilisateur");
  }
  if (actor.id === userId) {
    throw new ForbiddenError("Impossible de supprimer votre propre compte");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!target) throw new NotFoundError("Utilisateur introuvable");

  // Suppression physique (irréversible).
  await prisma.user.delete({
    where: { id: userId },
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "USER_DELETED_BY_ADMIN",
      targetType: "User",
      targetId: target.id,
      metadataJson: { email: target.email },
    },
  });

  return target;
}