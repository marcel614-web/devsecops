// apps/api/src/modules/projects/projects.service.ts
import {
  Prisma,
  ProjectMemberStatus,
  ProjectRole,
  Role,
  SecurityGateExceptionStatus,
  SpecialPermission,
} from "@prisma/client";
import { prisma } from "../../utils/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import {
  getEffectivePermissions,
  hasSpecialPermission,
  requirePermission,
} from "../authorization/permission.service";
import {
  PERMISSIONS,
  type PermissionValue,
} from "../authorization/permissions.constants";
import {
  isPlatformAdmin,
} from "../authorization/role-permissions";
import {
  projectAccessWhere,
  requireProjectMembership,
} from "../authorization/project-membership.service";
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
 * Vérifie une permission projet précise. Le refus par défaut est appliqué par
 * le service central : aucun service ne doit tester un rôle à la main.
 */
async function ensureProjectAccess(
  actor: ActorContext,
  projectId: string,
  required: PermissionValue = PERMISSIONS.PROJECT_READ,
): Promise<{ id: string; ownerId: string }> {
  await requirePermission(actor, required, {
    projectId,
    targetType: "Project",
    targetId: projectId,
  });
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true },
  });
  if (!project) throw new NotFoundError("Projet introuvable");
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
  // Isolation : PLATFORM_ADMIN voit tout, les autres uniquement leurs
  // projets (propriétaire historique ou membre actif).
  const where: Prisma.ProjectWhereInput = {
    AND: [projectAccessWhere(actor)],
  };

  if (query.technology) where.technology = query.technology;
  if (query.provider) where.provider = query.provider;
  if (query.search) {
    (where.AND as Prisma.ProjectWhereInput[]).push({
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { repoFullName: { contains: query.search, mode: "insensitive" } },
      ],
    });
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
  await ensureProjectAccess(actor, projectId, PERMISSIONS.PROJECT_READ);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ...PUBLIC_SELECT,
      config: true,
      owner: {
        select: { id: true, email: true, name: true },
      },
      _count: {
        select: { pipelines: true, deployments: true, members: true },
      },
    },
  });
  if (!project) throw new NotFoundError("Projet introuvable");

  const membership = await requireProjectMembership(actor, projectId);
  const permissions = await getEffectivePermissions(actor, projectId);

  return {
    ...project,
    currentUserRole: membership.role,
    isPlatformAdmin: membership.isPlatformAdmin,
    permissions: [...permissions].sort(),
  };
}

export async function createProject(actor: ActorContext, input: CreateProjectInput) {
  // Vérifie que le serverId (si fourni) appartient bien au demandeur.
  if (input.serverId) {
    const server = await prisma.deploymentServer.findUnique({
      where: { id: input.serverId },
      select: { id: true, ownerId: true },
    });
    if (!server) throw new NotFoundError("Serveur de déploiement introuvable");
    const owner = await prisma.user.findUnique({
      where: { id: server.ownerId },
      select: { role: true },
    });
    const allowed =
      isPlatformAdmin(actor.role) ||
      server.ownerId === actor.id ||
      isPlatformAdmin(owner?.role ?? "");
    if (!allowed) {
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
        description: input.description?.trim() || null,
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

    // Le créateur devient OWNER explicite du projet. Le champ historique
    // ownerId est conservé pour compatibilité.
    await tx.projectMember.create({
      data: {
        projectId: created.id,
        userId: actor.id,
        role: ProjectRole.OWNER,
        status: ProjectMemberStatus.ACTIVE,
      },
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
  await ensureProjectAccess(actor, projectId, PERMISSIONS.PROJECT_UPDATE);

  // Si on change le serverId, il doit appartenir à l'acteur.
  if (input.serverId) {
    const server = await prisma.deploymentServer.findUnique({
      where: { id: input.serverId },
      select: { id: true, ownerId: true },
    });
    if (!server) throw new NotFoundError("Serveur de déploiement introuvable");
    const owner = await prisma.user.findUnique({
      where: { id: server.ownerId },
      select: { role: true },
    });
    const allowed =
      isPlatformAdmin(actor.role) ||
      server.ownerId === actor.id ||
      isPlatformAdmin(owner?.role ?? "");
    if (!allowed) {
      throw new ForbiddenError("Ce serveur ne vous appartient pas");
    }
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
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
  await ensureProjectAccess(actor, projectId, PERMISSIONS.PROJECT_DELETE);

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
  await ensureProjectAccess(actor, projectId, PERMISSIONS.PROJECT_READ);

  const config = await prisma.projectConfiguration.findUnique({
    where: { projectId },
  });
  if (!config) throw new NotFoundError("Configuration introuvable");
  return config;
}

/**
 * Champs qui relèvent de la politique de sécurité. Ils peuvent être modifiés
 * par un porteur de MANAGE_SECURITY_POLICY, sans lui donner pour autant le
 * droit de changer le dépôt, les serveurs, les ports ou la planification.
 */
const SECURITY_POLICY_FIELDS = [
  "mandatoryControls",
  "requireExceptionApproval",
  "gateMode",
  "gateEnforcementAt",
  "securityGateCritical",
  "securityGateHigh",
  "securityGateMedium",
  "securityGateLow",
  "gateSecretsEnabled",
  "gateSastEnabled",
  "gateScaEnabled",
  "gateIacEnabled",
  "gateImageEnabled",
  "gateDastEnabled",
  "requireProductionApproval",
  "deploymentStrategy",
  "gitleaksEnabled",
  "semgrepEnabled",
  "scaEnabled",
  "iacEnabled",
  "trivyEnabled",
  "syftEnabled",
  "zapEnabled",
  "cosignEnabled",
  "ansibleLintEnabled",
  "ansibleSyntaxCheckEnabled",
] as const;

const SECURITY_POLICY_FIELD_SET = new Set<string>(SECURITY_POLICY_FIELDS);

export async function updateProjectConfig(
  actor: ActorContext,
  projectId: string,
  input: UpdateProjectConfigInput,
) {
  await ensureProjectAccess(actor, projectId, PERMISSIONS.PROJECT_READ);

  const current = await prisma.projectConfiguration.findUnique({
    where: { projectId },
  });
  if (!current) throw new NotFoundError("Configuration introuvable");

  const effectivePermissions = await getEffectivePermissions(actor, projectId);
  const canConfigureProject =
    isPlatformAdmin(actor.role) ||
    effectivePermissions.has(PERMISSIONS.PROJECT_CONFIGURE);
  const canManagePolicy =
    isPlatformAdmin(actor.role) ||
    (await hasSpecialPermission(
      actor,
      SpecialPermission.MANAGE_SECURITY_POLICY,
      projectId,
    ));

  if (!canConfigureProject && !canManagePolicy) {
    throw new ForbiddenError(
      "Permission requise pour modifier la configuration du projet",
    );
  }

  const requestedFields = Object.keys(input);
  const requestedPolicyFields = requestedFields.filter((field) =>
    SECURITY_POLICY_FIELD_SET.has(field),
  );
  const hasProtectedPolicyField = requestedPolicyFields.length > 0;
  const hasNonPolicyField = requestedFields.some(
    (field) => !SECURITY_POLICY_FIELD_SET.has(field),
  );

  // Un porteur de MANAGE_SECURITY_POLICY ne peut modifier que les champs de
  // politique ; les autres champs restent réservés à PROJECT_CONFIGURE.
  if (!canConfigureProject && hasNonPolicyField) {
    throw new ForbiddenError(
      "MANAGE_SECURITY_POLICY ne permet de modifier que la politique de sécurité",
    );
  }

  if (!canManagePolicy && hasProtectedPolicyField) {
    throw new ForbiddenError(
      "La politique de sécurité est protégée : la permission spéciale MANAGE_SECURITY_POLICY est requise",
    );
  }

  if (!canManagePolicy) {
    const mandatory = new Set(current.mandatoryControls);
    const disabledMandatory =
      (mandatory.has("SECRET") && input.gitleaksEnabled === false) ||
      (mandatory.has("SAST") && input.semgrepEnabled === false) ||
      (mandatory.has("SCA") && input.scaEnabled === false) ||
      (mandatory.has("IAC") && input.iacEnabled === false) ||
      (mandatory.has("IMAGE") && input.trivyEnabled === false) ||
      (mandatory.has("DAST") && input.zapEnabled === false);
    if (disabledMandatory) {
      throw new ForbiddenError(
        "Ce scanner est un contrôle obligatoire et ne peut pas être désactivé",
      );
    }
  }

  const policyChangingFields = SECURITY_POLICY_FIELDS;
  const policyChanged = policyChangingFields.some(
    (key) => input[key] !== undefined,
  );

  // La planification est dérivée de la configuration : activer un rescan
  // fixe la première échéance après un intervalle complet (aucune surprise
  // immédiate), le désactiver efface l'échéance. Aucun second scheduler.
  const now = new Date();
  const intervalHours = input.rescanIntervalHours ?? current.rescanIntervalHours;
  let rescanNextRunAt: Date | null | undefined;
  if (input.rescanEnabled === false) {
    rescanNextRunAt = null;
  } else if (input.rescanEnabled === true) {
    rescanNextRunAt = new Date(now.getTime() + intervalHours * 3_600_000);
  } else if (current.rescanEnabled && input.rescanIntervalHours !== undefined) {
    rescanNextRunAt = new Date(now.getTime() + intervalHours * 3_600_000);
  }

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
      ...(input.productionPort !== undefined
        ? { productionPort: input.productionPort }
        : {}),
      ...(input.autoRollback !== undefined
        ? { autoRollback: input.autoRollback }
        : {}),
      ...(input.requireProductionApproval !== undefined
        ? { requireProductionApproval: input.requireProductionApproval }
        : {}),
      ...(input.securityGateCritical !== undefined
        ? { securityGateCritical: input.securityGateCritical }
        : {}),
      ...(input.securityGateHigh !== undefined ? { securityGateHigh: input.securityGateHigh } : {}),
      ...(input.securityGateMedium !== undefined
        ? { securityGateMedium: input.securityGateMedium }
        : {}),
      ...(input.securityGateLow !== undefined ? { securityGateLow: input.securityGateLow } : {}),
      ...(input.mandatoryControls !== undefined
        ? { mandatoryControls: input.mandatoryControls }
        : {}),
      ...(input.requireExceptionApproval !== undefined
        ? { requireExceptionApproval: input.requireExceptionApproval }
        : {}),
      ...(input.ansibleLintEnabled !== undefined
        ? { ansibleLintEnabled: input.ansibleLintEnabled }
        : {}),
      ...(input.ansibleSyntaxCheckEnabled !== undefined
        ? { ansibleSyntaxCheckEnabled: input.ansibleSyntaxCheckEnabled }
        : {}),
      ...(input.ansibleTimeoutMs !== undefined
        ? { ansibleTimeoutMs: input.ansibleTimeoutMs }
        : {}),
      ...(input.ansibleMaxPlaybooks !== undefined
        ? { ansibleMaxPlaybooks: input.ansibleMaxPlaybooks }
        : {}),
      ...(input.postDeployChecksEnabled !== undefined
        ? { postDeployChecksEnabled: input.postDeployChecksEnabled }
        : {}),
      ...(input.healthcheckPath !== undefined
        ? { healthcheckPath: input.healthcheckPath }
        : {}),
      ...(input.healthcheckTimeoutMs !== undefined
        ? { healthcheckTimeoutMs: input.healthcheckTimeoutMs }
        : {}),
      ...(input.rescanEnabled !== undefined
        ? { rescanEnabled: input.rescanEnabled }
        : {}),
      ...(input.rescanIntervalHours !== undefined
        ? { rescanIntervalHours: input.rescanIntervalHours }
        : {}),
      ...(input.rescanControls !== undefined
        ? { rescanControls: input.rescanControls }
        : {}),
      ...(input.rescanTimeoutMs !== undefined
        ? { rescanTimeoutMs: input.rescanTimeoutMs }
        : {}),
      ...(input.rescanMaxRunsPerDay !== undefined
        ? { rescanMaxRunsPerDay: input.rescanMaxRunsPerDay }
        : {}),
      ...(input.rescanRemediationEnabled !== undefined
        ? { rescanRemediationEnabled: input.rescanRemediationEnabled }
        : {}),
      ...(rescanNextRunAt !== undefined ? { rescanNextRunAt } : {}),
      ...(policyChanged
        ? {
            policyVersion: { increment: 1 },
            policyUpdatedAt: new Date(),
            policyUpdatedById: actor.id,
          }
        : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "PROJECT_CONFIG_UPDATED",
      targetType: "Project",
      targetId: projectId,
      metadataJson: {
        policyVersion: updated.policyVersion,
        policyChanged,
        fields: Object.keys(input),
      },
    },
  });

  return updated;
}

// ============================================================
// EXCEPTIONS DE SECURITY GATE
// ============================================================

async function expireGateExceptions(projectId: string): Promise<void> {
  const now = new Date();
  // Une exception PENDING expirée ne doit pas rester éternellement en attente :
  // elle est marquée EXPIRED et ne peut plus être approuvée.
  const expired = await prisma.securityGateException.findMany({
    where: {
      projectId,
      status: {
        in: [
          SecurityGateExceptionStatus.PENDING,
          SecurityGateExceptionStatus.APPROVED,
        ],
      },
      expiresAt: { lte: now },
    },
    select: { id: true, status: true },
  });
  if (expired.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const row of expired) {
      await tx.securityGateException.update({
        where: { id: row.id },
        data: { status: SecurityGateExceptionStatus.EXPIRED },
      });
      await tx.securityGateExceptionEvent.create({
        data: {
          exceptionId: row.id,
          action: "EXPIRED",
          fromStatus: row.status,
          toStatus: "EXPIRED",
        },
      });
    }
  });
}

const EXCEPTION_INCLUDE = {
  createdBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
  events: {
    orderBy: { createdAt: "desc" as const },
    include: {
      actor: { select: { id: true, name: true, email: true } },
    },
  },
};

export async function listGateExceptions(
  actor: ActorContext,
  projectId: string,
) {
  await ensureProjectAccess(actor, projectId, PERMISSIONS.SECURITY_GATE_READ);
  await expireGateExceptions(projectId);

  return prisma.securityGateException.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: EXCEPTION_INCLUDE,
  });
}

export async function getGateException(
  actor: ActorContext,
  projectId: string,
  exceptionId: string,
) {
  await ensureProjectAccess(actor, projectId, PERMISSIONS.SECURITY_GATE_READ);
  await expireGateExceptions(projectId);

  const exception = await prisma.securityGateException.findFirst({
    where: { id: exceptionId, projectId },
    include: EXCEPTION_INCLUDE,
  });
  if (!exception) throw new NotFoundError("Exception introuvable");
  return exception;
}

export async function createGateException(
  actor: ActorContext,
  projectId: string,
  input: CreateGateExceptionInput,
) {
  await ensureProjectAccess(actor, projectId, PERMISSIONS.SECURITY_GATE_CONFIGURE);

  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new ConflictError("La date d'expiration doit être dans le futur");
  }
  if (input.category === "ALL" && !input.fingerprint.trim()) {
    throw new ConflictError(
      "Une exception doit cibler une empreinte, une CVE ou une règle précise",
    );
  }

  const config = await prisma.projectConfiguration.findUnique({
    where: { projectId },
    select: { requireExceptionApproval: true },
  });
  const autoApprove =
    isPlatformAdmin(actor.role) || config?.requireExceptionApproval === false;
  const status = autoApprove
    ? SecurityGateExceptionStatus.APPROVED
    : SecurityGateExceptionStatus.PENDING;

  const exception = await prisma.$transaction(async (tx) => {
    const created = await tx.securityGateException.create({
      data: {
        projectId,
        category: input.category,
        severity: input.severity ?? null,
        fingerprint: input.fingerprint,
        matchType: input.matchType,
        reason: input.reason,
        expiresAt: input.expiresAt ?? null,
        createdById: actor.id,
        status,
        approvedById: autoApprove ? actor.id : null,
        approvedAt: autoApprove ? new Date() : null,
      },
    });

    await tx.securityGateExceptionEvent.create({
      data: {
        exceptionId: created.id,
        actorId: actor.id,
        action: "REQUESTED",
        toStatus: status,
        metadataJson: {
          category: created.category,
          severity: created.severity,
          fingerprint: created.fingerprint,
          matchType: created.matchType,
          expiresAt: created.expiresAt?.toISOString() ?? null,
        },
      },
    });

    if (autoApprove) {
      await tx.securityGateExceptionEvent.create({
        data: {
          exceptionId: created.id,
          actorId: actor.id,
          action: "APPROVED",
          fromStatus: SecurityGateExceptionStatus.PENDING,
          toStatus: SecurityGateExceptionStatus.APPROVED,
          metadataJson: {
            autoApproved: true,
            reason:
              isPlatformAdmin(actor.role)
                ? "Créée par un administrateur"
                : "Approbation désactivée par la politique",
          },
        },
      });
    }

    return created;
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
        fingerprint: exception.fingerprint,
        matchType: exception.matchType,
        status: exception.status,
        expiresAt: exception.expiresAt?.toISOString() ?? null,
        reason: exception.reason,
      },
    },
  });

  return exception;
}

export async function decideGateException(
  actor: ActorContext,
  projectId: string,
  exceptionId: string,
  decision: "APPROVE" | "REJECT" | "REVOKE",
  comment?: string,
) {
  await ensureProjectAccess(actor, projectId, PERMISSIONS.SECURITY_GATE_READ);
  await expireGateExceptions(projectId);

  const exception = await prisma.securityGateException.findFirst({
    where: { id: exceptionId, projectId },
  });
  if (!exception) throw new NotFoundError("Exception introuvable");

  const now = new Date();
  let nextStatus: SecurityGateExceptionStatus;
  let action: string;

  if (decision === "APPROVE") {
    await requirePermission(actor, PERMISSIONS.SECURITY_GATE_APPROVE, {
      projectId,
      targetType: "SecurityGateException",
      targetId: exceptionId,
    });
    if (exception.status !== SecurityGateExceptionStatus.PENDING) {
      throw new ConflictError("Seule une exception en attente peut être approuvée");
    }
    if (exception.createdById === actor.id) {
      throw new ForbiddenError(
        "Le demandeur ne peut pas approuver sa propre exception",
      );
    }
    if (exception.expiresAt && exception.expiresAt.getTime() <= now.getTime()) {
      throw new ConflictError("Cette exception est déjà expirée");
    }
    nextStatus = SecurityGateExceptionStatus.APPROVED;
    action = "APPROVED";
  } else if (decision === "REJECT") {
    await requirePermission(actor, PERMISSIONS.SECURITY_GATE_APPROVE, {
      projectId,
      targetType: "SecurityGateException",
      targetId: exceptionId,
    });
    if (exception.status !== SecurityGateExceptionStatus.PENDING) {
      throw new ConflictError("Seule une exception en attente peut être rejetée");
    }
    nextStatus = SecurityGateExceptionStatus.REJECTED;
    action = "REJECTED";
  } else {
    const canRevoke =
      isPlatformAdmin(actor.role) || exception.createdById === actor.id;
    if (!canRevoke) {
      await requirePermission(actor, PERMISSIONS.SECURITY_GATE_APPROVE, {
        projectId,
        targetType: "SecurityGateException",
        targetId: exceptionId,
      });
    }
    if (
      exception.status !== SecurityGateExceptionStatus.PENDING &&
      exception.status !== SecurityGateExceptionStatus.APPROVED
    ) {
      throw new ConflictError("Cette exception ne peut plus être révoquée");
    }
    nextStatus = SecurityGateExceptionStatus.REVOKED;
    action = "REVOKED";
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.securityGateException.update({
      where: { id: exceptionId },
      data: {
        status: nextStatus,
        ...(decision === "APPROVE"
          ? { approvedById: actor.id, approvedAt: now }
          : {}),
        ...(decision === "REJECT" ? { rejectedAt: now } : {}),
        ...(decision === "REVOKE" ? { revokedAt: now } : {}),
      },
    });

    await tx.securityGateExceptionEvent.create({
      data: {
        exceptionId,
        actorId: actor.id,
        action,
        fromStatus: exception.status,
        toStatus: nextStatus,
        metadataJson: comment ? { comment } : undefined,
      },
    });

    // Relecture après insertion de l'événement pour renvoyer l'historique
    // complet, y compris la décision qui vient d'être prise.
    return tx.securityGateException.findUniqueOrThrow({
      where: { id: exceptionId },
      include: EXCEPTION_INCLUDE,
    });
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: `SECURITY_GATE_EXCEPTION_${action}`,
      targetType: "SecurityGateException",
      targetId: exceptionId,
      metadataJson: {
        projectId,
        fromStatus: exception.status,
        toStatus: nextStatus,
        comment: comment ?? null,
      },
    },
  });

  return updated;
}

/**
 * Conservation de l'endpoint DELETE historique : une exception n'est jamais
 * supprimée physiquement, elle est révoquée pour conserver son historique.
 */
export async function deleteGateException(
  actor: ActorContext,
  projectId: string,
  exceptionId: string,
) {
  return decideGateException(actor, projectId, exceptionId, "REVOKE");
}