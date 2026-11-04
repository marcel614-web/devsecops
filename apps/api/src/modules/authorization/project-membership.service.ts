// apps/api/src/modules/authorization/project-membership.service.ts
import {
  Prisma,
  ProjectMemberStatus,
  ProjectRole,
  Role,
  UserStatus,
} from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { ConflictError, ForbiddenError, NotFoundError } from "../../utils/errors";
import { isPlatformAdmin } from "./role-permissions";

export interface AuthorizationActor {
  id: string;
  role: Role | string;
  status?: UserStatus | string;
}

export interface ResolvedProjectMembership {
  projectId: string;
  projectName: string;
  role: ProjectRole;
  status: ProjectMemberStatus;
  isPlatformAdmin: boolean;
  memberId: string | null;
}

/**
 * Charge le projet minimal nécessaire aux décisions d'autorisation.
 * Une ressource inexistante renvoie 404 : elle ne doit jamais révéler
 * l'existence d'un projet à un utilisateur non membre.
 */
export async function loadProjectForAuthorization(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true, name: true },
  });
  if (!project) throw new NotFoundError("Projet introuvable");
  return project;
}

/**
 * Résout le rôle effectif d'un acteur sur un projet.
 *
 * Règles :
 *  - PLATFORM_ADMIN : accès administratif complet (rôle synthétique OWNER) ;
 *  - membre ACTIVE : son rôle ProjectRole ;
 *  - propriétaire historique sans ligne ProjectMember : OWNER (compatibilité
 *    des projets créés avant l'introduction du RBAC) ;
 *  - tout le reste : refus.
 */
export async function requireProjectMembership(
  actor: AuthorizationActor,
  projectId: string,
): Promise<ResolvedProjectMembership> {
  const project = await loadProjectForAuthorization(projectId);

  if (isPlatformAdmin(actor.role)) {
    return {
      projectId: project.id,
      projectName: project.name,
      role: ProjectRole.OWNER,
      status: ProjectMemberStatus.ACTIVE,
      isPlatformAdmin: true,
      memberId: null,
    };
  }

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: actor.id } },
    select: { id: true, role: true, status: true },
  });

  if (member) {
    if (member.status !== ProjectMemberStatus.ACTIVE) {
      throw new ForbiddenError("Votre appartenance à ce projet n'est pas active");
    }
    return {
      projectId: project.id,
      projectName: project.name,
      role: member.role,
      status: member.status,
      isPlatformAdmin: false,
      memberId: member.id,
    };
  }

  // Compatibilité : le propriétaire historique reste OWNER tant qu'aucune
  // ligne d'appartenance n'a été créée pour lui.
  if (project.ownerId === actor.id) {
    return {
      projectId: project.id,
      projectName: project.name,
      role: ProjectRole.OWNER,
      status: ProjectMemberStatus.ACTIVE,
      isPlatformAdmin: false,
      memberId: null,
    };
  }

  throw new ForbiddenError("Accès interdit à ce projet");
}

export async function getProjectRoleOrNull(
  actor: AuthorizationActor,
  projectId: string,
): Promise<ProjectRole | null> {
  try {
    return (await requireProjectMembership(actor, projectId)).role;
  } catch (err) {
    if (err instanceof ForbiddenError) return null;
    throw err;
  }
}

/**
 * Filtre Prisma réutilisable pour toutes les listes transverses :
 * un ADMIN voit tout, un utilisateur ne voit que ses projets (propriétaire
 * historique ou membre actif).
 */
export function projectAccessWhere(
  actor: AuthorizationActor,
): Prisma.ProjectWhereInput {
  if (isPlatformAdmin(actor.role)) return {};
  return {
    OR: [
      { ownerId: actor.id },
      {
        members: {
          some: {
            userId: actor.id,
            status: ProjectMemberStatus.ACTIVE,
          },
        },
      },
    ],
  };
}

export async function listAccessibleProjectIds(
  actor: AuthorizationActor,
): Promise<string[] | null> {
  if (isPlatformAdmin(actor.role)) return null;
  const projects = await prisma.project.findMany({
    where: projectAccessWhere(actor),
    select: { id: true },
  });
  return projects.map((project) => project.id);
}

/**
 * Compte les OWNER actifs en incluant le propriétaire historique qui n'a pas
 * encore de ligne ProjectMember. `excludeUserId` permet de simuler un retrait
 * ou une rétrogradation avant de l'appliquer.
 */
export async function countActiveOwners(
  projectId: string,
  excludeUserId?: string,
): Promise<number> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });
  if (!project) throw new NotFoundError("Projet introuvable");

  const members = await prisma.projectMember.findMany({
    where: {
      projectId,
      role: ProjectRole.OWNER,
      status: ProjectMemberStatus.ACTIVE,
    },
    select: { userId: true },
  });
  const owners = new Set(members.map((member) => member.userId));

  const legacyOwnerMembership = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: { projectId, userId: project.ownerId },
    },
    select: { status: true },
  });
  if (!legacyOwnerMembership) owners.add(project.ownerId);

  if (excludeUserId) owners.delete(excludeUserId);
  return owners.size;
}

export async function ensureAtLeastOneOwner(
  projectId: string,
  excludeUserId?: string,
): Promise<void> {
  const count = await countActiveOwners(projectId, excludeUserId);
  if (count === 0) {
    throw new ConflictError(
      "Un projet doit conserver au moins un OWNER actif. Désignez un remplaçant avant ce changement.",
    );
  }
}
