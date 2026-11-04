// apps/api/src/modules/github/project-teams.service.ts
import { prisma } from "../../utils/prisma";
import { ForbiddenError, NotFoundError } from "../../utils/errors";
import {
  hasSpecialPermission,
  requirePermission,
} from "../authorization/permission.service";
import { PERMISSIONS } from "../authorization/permissions.constants";
import { isPlatformAdmin } from "../authorization/role-permissions";
import { SpecialPermission } from "@prisma/client";
import type { GitHubActor } from "./teams.service";

async function loadProjectForActor(actor: GitHubActor, projectId: string) {
  await requirePermission(actor, PERMISSIONS.GITHUB_TEAM_READ, {
    projectId,
    targetType: "Project",
    targetId: projectId,
  });
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, ownerId: true },
  });
  if (!project) throw new NotFoundError("Projet introuvable");
  return project;
}

async function requireTeamManagement(actor: GitHubActor, projectId: string) {
  await requirePermission(actor, PERMISSIONS.GITHUB_TEAM_MANAGE, {
    projectId,
    targetType: "Project",
    targetId: projectId,
  });
}

const teamSelect = {
  id: true,
  githubTeamId: true,
  installationId: true,
  orgLogin: true,
  slug: true,
  name: true,
  description: true,
  privacy: true,
  parentTeamId: true,
  parentTeamSlug: true,
  htmlUrl: true,
  membersCount: true,
  reposCount: true,
  syncState: true,
  lastSyncedAt: true,
  installation: {
    select: {
      installationId: true,
      accountLogin: true,
      accountType: true,
    },
  },
} as const;

export async function listProjectTeams(
  actor: GitHubActor,
  projectId: string,
) {
  await loadProjectForActor(actor, projectId);

  const links = await prisma.projectTeam.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      team: { select: teamSelect },
    },
  });

  return { items: links };
}

export async function listAvailableTeams(
  actor: GitHubActor,
  projectId: string,
) {
  await loadProjectForActor(actor, projectId);

  const canUseAllInstallations =
    isPlatformAdmin(actor.role) ||
    (await hasSpecialPermission(
      actor,
      SpecialPermission.MANAGE_GITHUB_TEAMS,
      projectId,
    ));

  const teams = await prisma.gitHubTeam.findMany({
    where: {
      syncState: { not: "DELETED" },
      installation: {
        revokedAt: null,
        // Un administrateur (ou une permission spéciale) peut associer une
        // équipe de n'importe quelle installation active ; un utilisateur
        // standard ne voit que ses propres installations.
        ...(canUseAllInstallations ? {} : { userId: actor.id }),
      },
    },
    orderBy: [{ orgLogin: "asc" }, { name: "asc" }],
    select: teamSelect,
  });

  return { items: teams };
}

export type ProjectTeamRoleValue =
  | "OWNER"
  | "MAINTAINER"
  | "DEVELOPER"
  | "SECURITY_ANALYST"
  | "VIEWER";

export async function associateTeamToProject(
  actor: GitHubActor,
  projectId: string,
  teamLocalId: string,
  role: ProjectTeamRoleValue,
) {
  const project = await loadProjectForActor(actor, projectId);
  await requireTeamManagement(actor, projectId);

  const team = await prisma.gitHubTeam.findUnique({
    where: { id: teamLocalId },
    select: {
      id: true,
      name: true,
      slug: true,
      orgLogin: true,
      syncState: true,
      installation: {
        select: { userId: true, revokedAt: true },
      },
    },
  });

  if (!team || team.syncState === "DELETED") {
    throw new NotFoundError(
      "Équipe GitHub introuvable dans le cache local (resynchronisez l'organisation).",
    );
  }
  if (team.installation.revokedAt) {
    throw new NotFoundError(
      "L'installation GitHub de cette équipe a été révoquée.",
    );
  }
  const canUseInstallation =
    isPlatformAdmin(actor.role) ||
    team.installation.userId === actor.id ||
    (await hasSpecialPermission(
      actor,
      SpecialPermission.MANAGE_GITHUB_TEAMS,
      projectId,
    ));
  if (!canUseInstallation) {
    throw new ForbiddenError(
      "Cette équipe GitHub n'appartient pas à une installation autorisée pour cet utilisateur.",
    );
  }

  const link = await prisma.projectTeam.upsert({
    where: {
      projectId_githubTeamId: {
        projectId,
        githubTeamId: team.id,
      },
    },
    create: { projectId, githubTeamId: team.id, role },
    update: { role },
    select: {
      id: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      team: { select: teamSelect },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "PROJECT_TEAM_ASSOCIATED",
      targetType: "Project",
      targetId: projectId,
      metadataJson: {
        project: project.name,
        team: `${team.orgLogin}/${team.slug}`,
        role,
      },
    },
  });

  return link;
}

interface TeamContext {
  installationId: string;
  slug: string;
}

async function loadLinkForActor(
  actor: GitHubActor,
  linkId: string,
  teamContext?: TeamContext,
) {
  const link = await prisma.projectTeam.findUnique({
    where: { id: linkId },
    select: {
      id: true,
      projectId: true,
      githubTeamId: true,
      role: true,
      project: { select: { ownerId: true, name: true } },
      team: {
        select: {
          slug: true,
          orgLogin: true,
          installation: { select: { installationId: true } },
        },
      },
    },
  });

  if (!link) {
    throw new NotFoundError("Association équipe/projet introuvable");
  }
  await requireTeamManagement(actor, link.projectId);
  if (
    teamContext &&
    (link.team.installation.installationId !== teamContext.installationId ||
      link.team.slug !== teamContext.slug)
  ) {
    throw new NotFoundError(
      "Cette association n'appartient pas à l'équipe GitHub demandée",
    );
  }

  return link;
}

export async function updateProjectTeamRole(
  actor: GitHubActor,
  linkId: string,
  role: ProjectTeamRoleValue,
  teamContext?: TeamContext,
) {
  const link = await loadLinkForActor(actor, linkId, teamContext);

  const updated = await prisma.projectTeam.update({
    where: { id: link.id },
    data: { role },
    select: {
      id: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      team: { select: teamSelect },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "PROJECT_TEAM_ROLE_UPDATED",
      targetType: "Project",
      targetId: link.projectId,
      metadataJson: {
        project: link.project.name,
        team: `${link.team.orgLogin}/${link.team.slug}`,
        previousRole: link.role,
        role,
      },
    },
  });

  return updated;
}

export async function removeProjectTeam(
  actor: GitHubActor,
  linkId: string,
  teamContext?: TeamContext,
) {
  const link = await loadLinkForActor(actor, linkId, teamContext);

  await prisma.projectTeam.delete({ where: { id: link.id } });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "PROJECT_TEAM_DETACHED",
      targetType: "Project",
      targetId: link.projectId,
      metadataJson: {
        project: link.project.name,
        team: `${link.team.orgLogin}/${link.team.slug}`,
      },
    },
  });

  return { removed: true };
}

async function findTeamForActor(
  actor: GitHubActor,
  installationId: string,
  slug: string,
) {
  const canReadAll =
    isPlatformAdmin(actor.role) ||
    (await hasSpecialPermission(
      actor,
      SpecialPermission.MANAGE_GITHUB_TEAMS,
    ));

  const team = await prisma.gitHubTeam.findFirst({
    where: {
      slug,
      syncState: { not: "DELETED" },
      installation: {
        installationId,
        revokedAt: null,
        ...(canReadAll ? {} : { userId: actor.id }),
      },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      orgLogin: true,
      htmlUrl: true,
      installationId: true,
    },
  });

  if (!team) {
    throw new NotFoundError(
      "Équipe GitHub introuvable ou non autorisée pour cet utilisateur.",
    );
  }
  return team;
}

export async function listTeamProjects(
  actor: GitHubActor,
  installationId: string,
  slug: string,
) {
  const team = await findTeamForActor(actor, installationId, slug);

  const links = await prisma.projectTeam.findMany({
    where: { githubTeamId: team.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      project: {
        select: {
          id: true,
          name: true,
          repoFullName: true,
          ownerId: true,
        },
      },
    },
  });

  return { team, items: links };
}

export async function associateTeamToProjectFromTeam(
  actor: GitHubActor,
  installationId: string,
  slug: string,
  projectId: string,
  role: ProjectTeamRoleValue,
) {
  const team = await findTeamForActor(actor, installationId, slug);
  return associateTeamToProject(actor, projectId, team.id, role);
}

export async function updateProjectTeamRoleFromTeam(
  actor: GitHubActor,
  installationId: string,
  slug: string,
  linkId: string,
  role: ProjectTeamRoleValue,
) {
  return updateProjectTeamRole(actor, linkId, role, {
    installationId,
    slug,
  });
}

export async function removeProjectTeamFromTeam(
  actor: GitHubActor,
  installationId: string,
  slug: string,
  linkId: string,
) {
  return removeProjectTeam(actor, linkId, { installationId, slug });
}
