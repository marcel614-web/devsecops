// apps/api/src/modules/projects/projects.service.ts
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import type {
  CreateGateExceptionInput,
  CreateProjectInput,
  ProjectListQuery,
  UpdateProjectConfigInput,
  UpdateProjectInput,
} from "./projects.schema";

export interface ActorContext {
  id: string;
  role: Role;
}

/**
 * Vérifie qu'un acteur peut accéder à un projet.
 *  - ADMIN : tous les projets (lecture et écriture).
 *  - DEVELOPER : uniquement ses propres projets.
 *
 * Toujours appelé AVANT toute opération sur un projet.
 */
async function ensureProjectAccess(
  actor: ActorContext,
  projectId: string,
): Promise<{ id: string; ownerId: string }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true },
  });
  if (!project) throw new NotFoundError("Projet introuvable");

  if (actor.role === Role.ADMIN) return project;
  if (project.ownerId !== actor.id) {
    throw new ForbiddenError("Accès interdit à ce projet");
  }
  return project;
}

const PUBLIC_SELECT = {
  id: true,
  name: true,
  description: true,
  provider: true,
  repoFullName: true,
  repoId: true,
  defaultBranch: true,
  technology: true,
  deploymentEnabled: true,
  serverId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

export async function listProjects(actor: ActorContext, query: ProjectListQuery) {
  const where: Prisma.ProjectWhereInput = {};

  // Isolation : un DEVELOPER ne voit QUE ses projets.
  if (actor.role !== Role.ADMIN) {
    where.ownerId = actor.id;
  }

  if (query.technology) where.technology = query.technology;
  if (query.provider) where.provider = query.provider;
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { repoFullName: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.project.findMany({
      where,
      select: PUBLIC_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
    }),
    prisma.project.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export async function getProject(actor: ActorContext, projectId: string) {
  await ensureProjectAccess(actor, projectId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ...PUBLIC_SELECT,
      config: true,
      owner: {
        select: { id: true, email: true, name: true },
      },
      _count: {
        select: { pipelines: true, deployments: true },
      },
    },
  });
  if (!project) throw new NotFoundError("Projet introuvable");
  return project;
}

export async function createProject(actor: ActorContext, input: CreateProjectInput) {
  // Vérifie que le serverId (si fourni) appartient bien au demandeur.
  if (input.serverId) {
    const server = await prisma.deploymentServer.findUnique({
      where: { id: input.serverId },
      select: { id: true, ownerId: true },
    });
    if (!server) throw new NotFoundError("Serveur de déploiement introuvable");
    if (server.ownerId !== actor.id) {
      throw new ForbiddenError("Ce serveur ne vous appartient pas");
    }
  }

  // Unicité par couple (ownerId, repoFullName).
  const existing = await prisma.project.findUnique({
    where: {
      ownerId_repoFullName: {
        ownerId: actor.id,
        repoFullName: input.repoFullName,
      },
    },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError("Vous avez déjà un projet pour ce repository");
  }

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        ownerId: actor.id,
        name: input.name,
        description: input.description ?? null,
        provider: input.provider,
        repoFullName: input.repoFullName,
        repoId: input.repoId,
        defaultBranch: input.defaultBranch,
        technology: input.technology,
        deploymentEnabled: input.deploymentEnabled,
        serverId: input.serverId ?? null,
      },
      select: PUBLIC_SELECT,
    });

    // Configuration par défaut : branche cible, scanners activés, seuils du gate.
    await tx.projectConfiguration.create({
      data: {
        projectId: created.id,
        triggerBranches: [input.defaultBranch],
        gitleaksEnabled: true,
        semgrepEnabled: true,
        scaEnabled: true,
        trivyEnabled: true,
        zapEnabled: true,
        securityGateCritical: 0,
        securityGateHigh: 2,
        securityGateMedium: 10,
        securityGateLow: -1,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "PROJECT_CREATED",
        targetType: "Project",
        targetId: created.id,
        metadataJson: { repoFullName: created.repoFullName },
      },
    });

    return created;
  });

  return project;
}

export async function updateProject(
  actor: ActorContext,
  projectId: string,
  input: UpdateProjectInput,
) {
  await ensureProjectAccess(actor, projectId);

  // Si on change le serverId, il doit appartenir à l'acteur.
  if (input.serverId) {
    const server = await prisma.deploymentServer.findUnique({
      where: { id: input.serverId },
      select: { id: true, ownerId: true },
    });
    if (!server) throw new NotFoundError("Serveur de déploiement introuvable");
    if (server.ownerId !== actor.id) {
      throw new ForbiddenError("Ce serveur ne vous appartient pas");
    }
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.defaultBranch !== undefined ? { defaultBranch: input.defaultBranch } : {}),
      ...(input.technology !== undefined ? { technology: input.technology } : {}),
      ...(input.deploymentEnabled !== undefined
        ? { deploymentEnabled: input.deploymentEnabled }
        : {}),
      ...(input.serverId !== undefined ? { serverId: input.serverId } : {}),
    },
    select: PUBLIC_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "PROJECT_UPDATED",
      targetType: "Project",
      targetId: projectId,
    },
  });

  return updated;
}

export async function deleteProject(actor: ActorContext, projectId: string) {
  await ensureProjectAccess(actor, projectId);

  await prisma.project.delete({ where: { id: projectId } });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "PROJECT_DELETED",
      targetType: "Project",
      targetId: projectId,
    },
  });
}

export async function getProjectConfig(actor: ActorContext, projectId: string) {
  await ensureProjectAccess(actor, projectId);

  const config = await prisma.projectConfiguration.findUnique({
    where: { projectId },
  });
  if (!config) throw new NotFoundError("Configuration introuvable");
  return config;
}

export async function updateProjectConfig(
  actor: ActorContext,
  projectId: string,
  input: UpdateProjectConfigInput,
) {
  await ensureProjectAccess(actor, projectId);

  const updated = await prisma.projectConfiguration.update({
    where: { projectId },
    data: {
      ...(input.triggerBranches !== undefined ? { triggerBranches: input.triggerBranches } : {}),
      ...(input.gitleaksEnabled !== undefined ? { gitleaksEnabled: input.gitleaksEnabled } : {}),
      ...(input.semgrepEnabled !== undefined ? { semgrepEnabled: input.semgrepEnabled } : {}),
      ...(input.scaEnabled !== undefined ? { scaEnabled: input.scaEnabled } : {}),
      ...(input.iacEnabled !== undefined ? { iacEnabled: input.iacEnabled } : {}),
      ...(input.trivyEnabled !== undefined ? { trivyEnabled: input.trivyEnabled } : {}),
      ...(input.syftEnabled !== undefined ? { syftEnabled: input.syftEnabled } : {}),
      ...(input.zapEnabled !== undefined ? { zapEnabled: input.zapEnabled } : {}),
      ...(input.cosignEnabled !== undefined ? { cosignEnabled: input.cosignEnabled } : {}),
      ...(input.gateMode !== undefined ? { gateMode: input.gateMode } : {}),
      ...(input.gateEnforcementAt !== undefined
        ? { gateEnforcementAt: input.gateEnforcementAt }
        : {}),
      ...(input.gateSecretsEnabled !== undefined
        ? { gateSecretsEnabled: input.gateSecretsEnabled }
        : {}),
      ...(input.gateSastEnabled !== undefined
        ? { gateSastEnabled: input.gateSastEnabled }
        : {}),
      ...(input.gateScaEnabled !== undefined
        ? { gateScaEnabled: input.gateScaEnabled }
        : {}),
      ...(input.gateIacEnabled !== undefined
        ? { gateIacEnabled: input.gateIacEnabled }
        : {}),
      ...(input.gateImageEnabled !== undefined
        ? { gateImageEnabled: input.gateImageEnabled }
        : {}),
      ...(input.gateDastEnabled !== undefined
        ? { gateDastEnabled: input.gateDastEnabled }
        : {}),
      ...(input.deploymentStrategy !== undefined
        ? { deploymentStrategy: input.deploymentStrategy }
        : {}),
      ...(input.stagingPort !== undefined ? { stagingPort: input.stagingPort } : {}),
      ...(input.autoRollback !== undefined
        ? { autoRollback: input.autoRollback }
        : {}),
      ...(input.securityGateCritical !== undefined
        ? { securityGateCritical: input.securityGateCritical }
        : {}),
      ...(input.securityGateHigh !== undefined ? { securityGateHigh: input.securityGateHigh } : {}),
      ...(input.securityGateMedium !== undefined
        ? { securityGateMedium: input.securityGateMedium }
        : {}),
      ...(input.securityGateLow !== undefined ? { securityGateLow: input.securityGateLow } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "PROJECT_CONFIG_UPDATED",
      targetType: "Project",
      targetId: projectId,
    },
  });

  return updated;
}

// ============================================================
// EXCEPTIONS DE SECURITY GATE
// ============================================================

export async function listGateExceptions(
  actor: ActorContext,
  projectId: string,
) {
  await ensureProjectAccess(actor, projectId);

  return prisma.securityGateException.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function createGateException(
  actor: ActorContext,
  projectId: string,
  input: CreateGateExceptionInput,
) {
  await ensureProjectAccess(actor, projectId);

  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new ConflictError("La date d'expiration doit être dans le futur");
  }

  const exception = await prisma.securityGateException.create({
    data: {
      projectId,
      category: input.category,
      severity: input.severity ?? null,
      reason: input.reason,
      expiresAt: input.expiresAt ?? null,
      createdById: actor.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "SECURITY_GATE_EXCEPTION_CREATED",
      targetType: "SecurityGateException",
      targetId: exception.id,
      metadataJson: {
        projectId,
        category: exception.category,
        severity: exception.severity,
        expiresAt: exception.expiresAt?.toISOString() ?? null,
        reason: exception.reason,
      },
    },
  });

  return exception;
}

export async function deleteGateException(
  actor: ActorContext,
  projectId: string,
  exceptionId: string,
) {
  await ensureProjectAccess(actor, projectId);

  const exception = await prisma.securityGateException.findFirst({
    where: { id: exceptionId, projectId },
  });
  if (!exception) throw new NotFoundError("Exception introuvable");

  await prisma.securityGateException.delete({ where: { id: exceptionId } });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "SECURITY_GATE_EXCEPTION_DELETED",
      targetType: "SecurityGateException",
      targetId: exceptionId,
      metadataJson: { projectId, reason: exception.reason },
    },
  });
}