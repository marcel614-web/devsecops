// apps/api/src/modules/authorization/permission.service.ts
import {
  PermissionScopeType,
  ProjectMemberStatus,
  Role,
  SpecialPermission,
  UserStatus,
} from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { ForbiddenError, NotFoundError } from "../../utils/errors";
import { auditDenied } from "./authorization.audit";
import {
  ALL_PERMISSIONS,
  SPECIAL_PERMISSION_CAPABILITIES,
  type PermissionValue,
} from "./permissions.constants";
import {
  GLOBAL_ROLE_PERMISSIONS,
  PROJECT_ROLE_PERMISSIONS,
  isPlatformAdmin,
  normalizeGlobalRole,
} from "./role-permissions";
import {
  requireProjectMembership,
  type AuthorizationActor,
} from "./project-membership.service";

export type { AuthorizationActor };

interface PermissionOptions {
  projectId?: string | null;
  targetType?: string;
  targetId?: string;
  auditDenied?: boolean;
}

function activeGrantWhere(userId: string, projectId?: string | null) {
  const now = new Date();
  const scopeFilters =
    projectId === undefined || projectId === null
      ? [{ scopeType: PermissionScopeType.GLOBAL }]
      : [
          { scopeType: PermissionScopeType.GLOBAL },
          { scopeType: PermissionScopeType.PROJECT, scopeId: projectId },
        ];

  return {
    userId,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    AND: [{ OR: scopeFilters }],
  };
}

export async function getActiveSpecialPermissions(
  userId: string,
  projectId?: string | null,
): Promise<SpecialPermission[]> {
  const grants = await prisma.permissionGrant.findMany({
    where: activeGrantWhere(userId, projectId),
    select: { permission: true },
  });
  return [...new Set(grants.map((grant) => grant.permission))];
}

export async function hasSpecialPermission(
  actor: AuthorizationActor,
  special: SpecialPermission,
  projectId?: string | null,
): Promise<boolean> {
  if (isPlatformAdmin(actor.role)) return true;
  const grants = await getActiveSpecialPermissions(actor.id, projectId);
  return grants.includes(special);
}

function addSpecialCapabilities(
  target: Set<PermissionValue>,
  specialPermissions: SpecialPermission[],
): void {
  for (const special of specialPermissions) {
    for (const capability of SPECIAL_PERMISSION_CAPABILITIES[special] ?? []) {
      target.add(capability);
    }
  }
}

/**
 * Calcule les permissions effectives d'un acteur. Sans projet, seules les
 * permissions globales et les grants globaux sont pris en compte. Avec un
 * projet, l'appartenance active est obligatoire (sauf PLATFORM_ADMIN).
 */
export async function getEffectivePermissions(
  actor: AuthorizationActor,
  projectId?: string | null,
): Promise<Set<PermissionValue>> {
  if (isPlatformAdmin(actor.role)) {
    return new Set(ALL_PERMISSIONS);
  }

  const permissions = new Set<PermissionValue>(
    GLOBAL_ROLE_PERMISSIONS[normalizeGlobalRole(actor.role)],
  );

  if (projectId) {
    const membership = await requireProjectMembership(actor, projectId);
    for (const permission of PROJECT_ROLE_PERMISSIONS[membership.role]) {
      permissions.add(permission);
    }
  }

  const special = await getActiveSpecialPermissions(actor.id, projectId);
  addSpecialCapabilities(permissions, special);
  return permissions;
}

export async function can(
  actor: AuthorizationActor,
  required: PermissionValue,
  projectId?: string | null,
): Promise<boolean> {
  try {
    const permissions = await getEffectivePermissions(actor, projectId);
    return permissions.has(required);
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof NotFoundError) {
      return false;
    }
    throw err;
  }
}

export async function requirePermission(
  actor: AuthorizationActor,
  required: PermissionValue,
  options: PermissionOptions = {},
): Promise<void> {
  let permissions: Set<PermissionValue>;
  try {
    permissions = await getEffectivePermissions(actor, options.projectId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      if (options.auditDenied !== false) {
        await auditDenied({
          actorId: actor.id,
          permission: required,
          projectId: options.projectId ?? null,
          targetType: options.targetType,
          targetId: options.targetId,
        });
      }
      throw new ForbiddenError(
        `Permission requise : ${required}`,
      );
    }
    throw err;
  }

  if (!permissions.has(required)) {
    if (options.auditDenied !== false) {
      await auditDenied({
        actorId: actor.id,
        permission: required,
        projectId: options.projectId ?? null,
        targetType: options.targetType,
        targetId: options.targetId,
      });
    }
    throw new ForbiddenError(`Permission requise : ${required}`);
  }
}

export async function requireSpecialPermission(
  actor: AuthorizationActor,
  special: SpecialPermission,
  projectId?: string | null,
): Promise<void> {
  if (isPlatformAdmin(actor.role)) return;

  if (projectId) {
    // Un grant projet exige une appartenance active ; un grant global reste
    // valable sur tous les projets.
    await requireProjectMembership(actor, projectId);
  }

  const granted = await hasSpecialPermission(actor, special, projectId);
  if (!granted) {
    await auditDenied({
      actorId: actor.id,
      permission: `special:${special}`,
      projectId: projectId ?? null,
    });
    throw new ForbiddenError(
      `Permission spéciale requise : ${special}`,
    );
  }
}

export async function requirePlatformAdmin(
  actor: AuthorizationActor,
): Promise<void> {
  if (!isPlatformAdmin(actor.role)) {
    await auditDenied({
      actorId: actor.id,
      permission: "global:platform_admin",
    });
    throw new ForbiddenError(
      "Cette action est réservée aux administrateurs de la plateforme",
    );
  }
}

/**
 * Vue "droits effectifs" pour l'administration : ne renvoie jamais de secret,
 * uniquement les permissions calculées.
 */
export async function getEffectivePermissionsForUser(
  userId: string,
  projectId?: string | null,
): Promise<{
  user: { id: string; email: string; name: string; role: Role; status: UserStatus };
  projectRole: string | null;
  permissions: PermissionValue[];
  specialPermissions: SpecialPermission[];
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
    },
  });
  if (!user) throw new NotFoundError("Utilisateur introuvable");

  let projectRole: string | null = null;
  if (projectId) {
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true, status: true },
    });
    projectRole =
      membership?.status === ProjectMemberStatus.ACTIVE ? membership.role : null;
  }

  const actor: AuthorizationActor = { id: user.id, role: user.role };
  const permissions = await getEffectivePermissions(actor, projectId);
  const specialPermissions = await getActiveSpecialPermissions(userId, projectId);

  return {
    user,
    projectRole,
    permissions: [...permissions].sort(),
    specialPermissions,
  };
}
