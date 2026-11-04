// apps/api/src/modules/projects/project-members.service.ts
import crypto from "node:crypto";
import {
  PermissionScopeType,
  Prisma,
  ProjectMemberStatus,
  ProjectRole,
  SpecialPermission,
  UserStatus,
} from "@prisma/client";
import { prisma } from "../../utils/prisma";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { writeAuditLog } from "../authorization/authorization.audit";
import {
  getEffectivePermissionsForUser,
  requirePermission,
  requirePlatformAdmin,
} from "../authorization/permission.service";
import {
  PERMISSIONS,
  PROJECT_SCOPED_SPECIAL_PERMISSIONS,
  GLOBAL_ONLY_SPECIAL_PERMISSIONS,
} from "../authorization/permissions.constants";
import {
  ensureAtLeastOneOwner,
  requireProjectMembership,
  type AuthorizationActor,
} from "../authorization/project-membership.service";
import type {
  AcceptInvitationInput,
  GrantSpecialPermissionInput,
  InviteProjectMemberInput,
  UpdateProjectMemberRoleInput,
} from "./project-members.schema";

const INVITATION_TTL_DAYS = 7;
const INVITATION_MAX_TTL_DAYS = 30;

function hashInvitationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newInvitationToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

function invitationExpiry(days: number): Date {
  const safeDays = Math.min(Math.max(days, 1), INVITATION_MAX_TTL_DAYS);
  return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000);
}

const memberUserSelect = {
  id: true,
  email: true,
  name: true,
  username: true,
  status: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect;

async function assertCanManageMembers(
  actor: AuthorizationActor,
  projectId: string,
): Promise<void> {
  await requirePermission(actor, PERMISSIONS.PROJECT_MANAGE_MEMBERS, {
    projectId,
    targetType: "Project",
    targetId: projectId,
  });
}

async function assertCanReadMembers(
  actor: AuthorizationActor,
  projectId: string,
): Promise<void> {
  await requirePermission(actor, PERMISSIONS.PROJECT_MEMBER_READ, {
    projectId,
    targetType: "Project",
    targetId: projectId,
  });
}

/**
 * Seul un OWNER (ou PLATFORM_ADMIN) peut nommer, rétrograder ou retirer un
 * OWNER. Une permission spéciale MANAGE_PROJECT_MEMBERS ne suffit pas : elle
 * ne doit pas permettre une élévation de privilèges.
 */
async function assertCanManageOwnerRole(
  actor: AuthorizationActor,
  projectId: string,
): Promise<void> {
  const membership = await requireProjectMembership(actor, projectId);
  if (membership.isPlatformAdmin || membership.role === ProjectRole.OWNER) {
    return;
  }
  throw new ForbiddenError(
    "Seul un OWNER du projet peut modifier ou attribuer le rôle OWNER",
  );
}

export async function listProjectMembers(
  actor: AuthorizationActor,
  projectId: string,
) {
  await assertCanReadMembers(actor, projectId);

  const members = await prisma.projectMember.findMany({
    where: { projectId, status: { not: ProjectMemberStatus.REMOVED } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      user: { select: memberUserSelect },
      invitedBy: { select: { id: true, name: true, email: true } },
    },
  });

  const now = new Date();
  const grants = await prisma.permissionGrant.findMany({
    where: {
      userId: { in: members.map((member) => member.userId) },
      scopeType: PermissionScopeType.PROJECT,
      scopeId: projectId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      id: true,
      userId: true,
      permission: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  const grantsByUser = new Map<string, typeof grants>();
  for (const grant of grants) {
    const list = grantsByUser.get(grant.userId) ?? [];
    list.push(grant);
    grantsByUser.set(grant.userId, list);
  }

  return members.map((member) => ({
    ...member,
    specialPermissions: grantsByUser.get(member.userId) ?? [],
  }));
}

export async function listProjectInvitations(
  actor: AuthorizationActor,
  projectId: string,
) {
  await assertCanReadMembers(actor, projectId);

  return prisma.projectInvitation.findMany({
    where: { projectId, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      invitedBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function inviteProjectMember(
  actor: AuthorizationActor,
  projectId: string,
  input: InviteProjectMemberInput,
) {
  await assertCanManageMembers(actor, projectId);
  if (input.role === ProjectRole.OWNER) {
    await assertCanManageOwnerRole(actor, projectId);
  }

  const activeMember = await prisma.projectMember.findFirst({
    where: {
      projectId,
      status: ProjectMemberStatus.ACTIVE,
      user: { email: input.email },
    },
    select: { id: true },
  });
  if (activeMember) {
    throw new ConflictError("Cet utilisateur est déjà membre actif du projet");
  }

  const pending = await prisma.projectInvitation.findFirst({
    where: {
      projectId,
      email: input.email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (pending) {
    throw new ConflictError(
      "Une invitation est déjà en attente pour cet email. Utilisez le renvoi d'invitation.",
    );
  }

  const { token, tokenHash } = newInvitationToken();
  const expiresAt = invitationExpiry(input.expiresInDays ?? INVITATION_TTL_DAYS);

  const invitation = await prisma.projectInvitation.create({
    data: {
      projectId,
      email: input.email,
      role: input.role,
      tokenHash,
      invitedById: actor.id,
      expiresAt,
    },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "PROJECT_INVITATION_CREATED",
    targetType: "ProjectInvitation",
    targetId: invitation.id,
    projectId,
    metadata: { email: invitation.email, role: invitation.role },
  });

  // Le jeton brut n'est retourné qu'une seule fois et n'est jamais journalisé.
  return { invitation, token };
}

export async function resendProjectInvitation(
  actor: AuthorizationActor,
  projectId: string,
  invitationId: string,
) {
  await assertCanManageMembers(actor, projectId);

  const invitation = await prisma.projectInvitation.findFirst({
    where: {
      id: invitationId,
      projectId,
      acceptedAt: null,
      revokedAt: null,
    },
    select: { id: true, email: true, role: true },
  });
  if (!invitation) throw new NotFoundError("Invitation introuvable");

  const { token, tokenHash } = newInvitationToken();
  const expiresAt = invitationExpiry(INVITATION_TTL_DAYS);

  await prisma.projectInvitation.update({
    where: { id: invitation.id },
    data: { tokenHash, expiresAt },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "PROJECT_INVITATION_RESENT",
    targetType: "ProjectInvitation",
    targetId: invitation.id,
    projectId,
    metadata: { email: invitation.email, role: invitation.role },
  });

  return { token, expiresAt };
}

export async function revokeProjectInvitation(
  actor: AuthorizationActor,
  projectId: string,
  invitationId: string,
) {
  await assertCanManageMembers(actor, projectId);

  const invitation = await prisma.projectInvitation.findFirst({
    where: { id: invitationId, projectId, acceptedAt: null, revokedAt: null },
    select: { id: true, email: true },
  });
  if (!invitation) throw new NotFoundError("Invitation introuvable");

  await prisma.projectInvitation.update({
    where: { id: invitation.id },
    data: { revokedAt: new Date() },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "PROJECT_INVITATION_REVOKED",
    targetType: "ProjectInvitation",
    targetId: invitation.id,
    projectId,
    metadata: { email: invitation.email },
  });
}

export async function acceptProjectInvitation(
  actor: AuthorizationActor,
  input: AcceptInvitationInput,
) {
  const tokenHash = hashInvitationToken(input.token);
  const invitation = await prisma.projectInvitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      projectId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      invitedById: true,
    },
  });

  if (!invitation) {
    throw new BadRequestError("Invitation invalide");
  }
  if (invitation.acceptedAt) {
    throw new ConflictError("Cette invitation a déjà été acceptée");
  }
  if (invitation.revokedAt) {
    throw new ForbiddenError("Cette invitation a été révoquée");
  }
  if (invitation.expiresAt <= new Date()) {
    throw new ForbiddenError("Cette invitation a expiré");
  }

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { id: true, email: true, status: true, isActive: true },
  });
  if (!user || !user.isActive || user.status !== UserStatus.ACTIVE) {
    throw new ForbiddenError("Votre compte doit être actif pour accepter l'invitation");
  }
  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    throw new ForbiddenError(
      "Cette invitation est destinée à une autre adresse email",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: invitation.projectId,
          userId: actor.id,
        },
      },
      select: { id: true, status: true },
    });

    const member = existing
      ? await tx.projectMember.update({
          where: { id: existing.id },
          data: {
            role: invitation.role,
            status: ProjectMemberStatus.ACTIVE,
            invitedById: invitation.invitedById,
          },
          select: { id: true, role: true, status: true, projectId: true },
        })
      : await tx.projectMember.create({
          data: {
            projectId: invitation.projectId,
            userId: actor.id,
            role: invitation.role,
            status: ProjectMemberStatus.ACTIVE,
            invitedById: invitation.invitedById,
          },
          select: { id: true, role: true, status: true, projectId: true },
        });

    await tx.projectInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date(), acceptedById: actor.id },
    });

    return member;
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "PROJECT_INVITATION_ACCEPTED",
    targetType: "ProjectMember",
    targetId: result.id,
    projectId: invitation.projectId,
    metadata: { role: invitation.role, email: invitation.email },
  });

  return result;
}

export async function updateProjectMemberRole(
  actor: AuthorizationActor,
  projectId: string,
  memberId: string,
  input: UpdateProjectMemberRoleInput,
) {
  await assertCanManageMembers(actor, projectId);

  const member = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId },
    select: { id: true, userId: true, role: true, status: true },
  });
  if (!member || member.status === ProjectMemberStatus.REMOVED) {
    throw new NotFoundError("Membre introuvable");
  }

  if (member.role === ProjectRole.OWNER || input.role === ProjectRole.OWNER) {
    await assertCanManageOwnerRole(actor, projectId);
  }

  if (
    member.role === ProjectRole.OWNER &&
    input.role !== ProjectRole.OWNER
  ) {
    await ensureAtLeastOneOwner(projectId, member.userId);
  }

  const updated = await prisma.projectMember.update({
    where: { id: member.id },
    data: { role: input.role },
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      user: { select: memberUserSelect },
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "PROJECT_MEMBER_ROLE_UPDATED",
    targetType: "ProjectMember",
    targetId: member.id,
    projectId,
    metadata: { previousRole: member.role, newRole: input.role },
  });

  return updated;
}

export async function removeProjectMember(
  actor: AuthorizationActor,
  projectId: string,
  memberId: string,
) {
  await assertCanManageMembers(actor, projectId);

  const member = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId },
    select: { id: true, userId: true, role: true, status: true },
  });
  if (!member || member.status === ProjectMemberStatus.REMOVED) {
    throw new NotFoundError("Membre introuvable");
  }

  if (member.role === ProjectRole.OWNER) {
    await assertCanManageOwnerRole(actor, projectId);
    await ensureAtLeastOneOwner(projectId, member.userId);
  }

  await prisma.projectMember.update({
    where: { id: member.id },
    data: { status: ProjectMemberStatus.REMOVED },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "PROJECT_MEMBER_REMOVED",
    targetType: "ProjectMember",
    targetId: member.id,
    projectId,
    metadata: { removedUserId: member.userId, role: member.role },
  });
}

export async function listProjectPermissionGrants(
  actor: AuthorizationActor,
  projectId: string,
) {
  await assertCanReadMembers(actor, projectId);

  const now = new Date();
  return prisma.permissionGrant.findMany({
    where: {
      scopeType: PermissionScopeType.PROJECT,
      scopeId: projectId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      permission: true,
      expiresAt: true,
      createdAt: true,
      user: { select: memberUserSelect },
      grantedBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function grantSpecialPermission(
  actor: AuthorizationActor,
  projectId: string,
  input: GrantSpecialPermissionInput,
) {
  // Une permission globale ne peut jamais être attribuée depuis un
  // formulaire de projet, même par un administrateur.
  if (input.scopeType === PermissionScopeType.GLOBAL) {
    throw new BadRequestError(
      "Une permission globale doit être attribuée depuis l'administration de la plateforme",
    );
  }

  await assertCanManageMembers(actor, projectId);
  if (GLOBAL_ONLY_SPECIAL_PERMISSIONS.has(input.permission)) {
    throw new BadRequestError(
      "Cette permission spéciale est strictement globale et ne peut pas être attribuée sur un projet",
    );
  }
  if (!PROJECT_SCOPED_SPECIAL_PERMISSIONS.has(input.permission)) {
    throw new BadRequestError(
      "Cette permission spéciale n'est pas attribuable avec une portée projet",
    );
  }

  const membership = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: { projectId, userId: input.userId },
    },
    select: { status: true },
  });
  if (!membership || membership.status !== ProjectMemberStatus.ACTIVE) {
    throw new ConflictError(
      "L'utilisateur doit être membre actif du projet avant de recevoir une permission",
    );
  }

  if (input.expiresAt && input.expiresAt <= new Date()) {
    throw new BadRequestError("La date d'expiration doit être dans le futur");
  }

  const target = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, status: true, isActive: true },
  });
  if (!target || !target.isActive || target.status !== UserStatus.ACTIVE) {
    throw new ConflictError("L'utilisateur cible doit être actif");
  }

  const existing = await prisma.permissionGrant.findFirst({
    where: {
      userId: input.userId,
      permission: input.permission,
      scopeType: PermissionScopeType.PROJECT,
      scopeId: projectId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError("Cette permission spéciale est déjà active");
  }

  const grant = await prisma.permissionGrant.create({
    data: {
      userId: input.userId,
      permission: input.permission,
      scopeType: PermissionScopeType.PROJECT,
      scopeId: projectId,
      grantedById: actor.id,
      expiresAt: input.expiresAt ?? null,
    },
    select: {
      id: true,
      permission: true,
      scopeType: true,
      scopeId: true,
      expiresAt: true,
      createdAt: true,
      user: { select: memberUserSelect },
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "SPECIAL_PERMISSION_GRANTED",
    targetType: "PermissionGrant",
    targetId: grant.id,
    projectId,
    metadata: {
      userId: input.userId,
      permission: input.permission,
      scopeType: PermissionScopeType.PROJECT,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    },
  });

  return grant;
}

/** Attribution globale : réservée à PLATFORM_ADMIN, jamais depuis un projet. */
export async function grantGlobalSpecialPermission(
  actor: AuthorizationActor,
  input: GrantSpecialPermissionInput,
) {
  await requirePlatformAdmin(actor);

  if (input.scopeType !== PermissionScopeType.GLOBAL) {
    throw new BadRequestError("La portée globale est requise");
  }
  if (input.expiresAt && input.expiresAt <= new Date()) {
    throw new BadRequestError("La date d'expiration doit être dans le futur");
  }

  const target = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, status: true, isActive: true },
  });
  if (!target || !target.isActive || target.status !== UserStatus.ACTIVE) {
    throw new ConflictError("L'utilisateur cible doit être actif");
  }

  const existing = await prisma.permissionGrant.findFirst({
    where: {
      userId: input.userId,
      permission: input.permission,
      scopeType: PermissionScopeType.GLOBAL,
      scopeId: null,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError("Cette permission spéciale globale est déjà active");
  }

  const grant = await prisma.permissionGrant.create({
    data: {
      userId: input.userId,
      permission: input.permission,
      scopeType: PermissionScopeType.GLOBAL,
      scopeId: null,
      grantedById: actor.id,
      expiresAt: input.expiresAt ?? null,
    },
    select: {
      id: true,
      permission: true,
      scopeType: true,
      scopeId: true,
      expiresAt: true,
      createdAt: true,
      user: { select: memberUserSelect },
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "SPECIAL_PERMISSION_GRANTED",
    targetType: "PermissionGrant",
    targetId: grant.id,
    metadata: {
      userId: input.userId,
      permission: input.permission,
      scopeType: PermissionScopeType.GLOBAL,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    },
  });

  return grant;
}

export async function revokeSpecialPermission(
  actor: AuthorizationActor,
  projectId: string,
  grantId: string,
) {
  const grant = await prisma.permissionGrant.findUnique({
    where: { id: grantId },
    select: {
      id: true,
      userId: true,
      permission: true,
      scopeType: true,
      scopeId: true,
      revokedAt: true,
    },
  });
  if (!grant) throw new NotFoundError("Permission introuvable");
  if (grant.revokedAt) {
    throw new ConflictError("Cette permission est déjà révoquée");
  }
  if (grant.scopeType !== PermissionScopeType.PROJECT) {
    throw new ForbiddenError(
      "Une permission globale doit être révoquée depuis l'administration de la plateforme",
    );
  }
  if (grant.scopeId !== projectId) {
    throw new ForbiddenError("Cette permission appartient à un autre projet");
  }
  await assertCanManageMembers(actor, projectId);

  await prisma.permissionGrant.update({
    where: { id: grant.id },
    data: { revokedAt: new Date() },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "SPECIAL_PERMISSION_REVOKED",
    targetType: "PermissionGrant",
    targetId: grant.id,
    projectId,
    metadata: { userId: grant.userId, permission: grant.permission },
  });
}

export async function revokeGlobalSpecialPermission(
  actor: AuthorizationActor,
  grantId: string,
) {
  await requirePlatformAdmin(actor);

  const grant = await prisma.permissionGrant.findUnique({
    where: { id: grantId },
    select: {
      id: true,
      userId: true,
      permission: true,
      scopeType: true,
      revokedAt: true,
    },
  });
  if (!grant) throw new NotFoundError("Permission introuvable");
  if (grant.revokedAt) {
    throw new ConflictError("Cette permission est déjà révoquée");
  }
  if (grant.scopeType !== PermissionScopeType.GLOBAL) {
    throw new ForbiddenError("Cette permission n'est pas globale");
  }

  await prisma.permissionGrant.update({
    where: { id: grant.id },
    data: { revokedAt: new Date() },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "SPECIAL_PERMISSION_REVOKED",
    targetType: "PermissionGrant",
    targetId: grant.id,
    metadata: { userId: grant.userId, permission: grant.permission },
  });
}

export async function listGlobalPermissionGrants(actor: AuthorizationActor) {
  await requirePlatformAdmin(actor);

  const now = new Date();
  return prisma.permissionGrant.findMany({
    where: {
      scopeType: PermissionScopeType.GLOBAL,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      permission: true,
      expiresAt: true,
      createdAt: true,
      user: { select: memberUserSelect },
      grantedBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function getMemberEffectivePermissions(
  actor: AuthorizationActor,
  projectId: string,
  memberId: string,
) {
  await assertCanReadMembers(actor, projectId);
  const membership = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId },
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      user: { select: memberUserSelect },
    },
  });
  if (!membership || membership.status === ProjectMemberStatus.REMOVED) {
    throw new NotFoundError("Membre introuvable");
  }
  const target = await prisma.user.findUnique({
    where: { id: membership.userId },
    select: { id: true, role: true },
  });
  if (!target) throw new NotFoundError("Utilisateur introuvable");

  return {
    membership,
    ...(await getEffectivePermissionsForUser(target.id, projectId)),
  };
}
