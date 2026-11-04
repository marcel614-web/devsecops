// apps/api/src/modules/github/teams.service.ts
import type { Octokit } from "@octokit/rest";
import type { Role } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { logger } from "../../utils/logger";
import {
  fetchInstallation,
  getInstallationOctokit,
} from "./github-app.service";
import {
  buildTeamCapabilities,
  permissionRequiredError,
  toGitHubAppError,
  type TeamCapabilities,
} from "./github-api-error";

export interface GitHubActor {
  id: string;
  role: Role | string;
}

interface InstallationRow {
  id: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  accountId: string;
  suspendedAt: Date | null;
  lastOrgSyncedAt: Date | null;
  orgSyncState: string | null;
}

interface GitHubTeamPayload {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  privacy?: string;
  html_url: string;
  parent?: { id: number; slug: string } | null;
  members_count?: number;
  repos_count?: number;
}

interface GitHubUserPayload {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
}

const MAX_LIST_PAGES = 10;
const PER_PAGE = 100;

function permissionMap(
  installation: Awaited<ReturnType<typeof fetchInstallation>>,
): Record<string, unknown> {
  return (installation.permissions ?? {}) as Record<string, unknown>;
}

/**
 * Charge une installation GitHub appartenant à l'utilisateur.
 * Les équipes ne sont disponibles QUE pour les organisations : un compte
 * personnel GitHub n'est jamais traité comme une organisation.
 */
export async function loadInstallation(
  userId: string,
  installationId: string,
): Promise<InstallationRow> {
  const installation = await prisma.gitHubInstallation.findFirst({
    where: { installationId, userId, revokedAt: null },
    select: {
      id: true,
      installationId: true,
      accountLogin: true,
      accountType: true,
      accountId: true,
      suspendedAt: true,
      lastOrgSyncedAt: true,
      orgSyncState: true,
    },
  });

  if (!installation) {
    throw new NotFoundError(
      "Installation GitHub introuvable ou non autorisée pour cet utilisateur",
    );
  }
  if (installation.accountType !== "Organization") {
    throw new BadRequestError(
      "Les équipes GitHub ne sont disponibles que pour une installation sur une organisation. " +
        "Les comptes personnels conservent la gestion des dépôts individuels.",
    );
  }
  if (installation.suspendedAt) {
    throw new BadRequestError(
      "Cette installation GitHub est suspendue : réactivez-la avant de gérer les équipes.",
    );
  }
  return installation;
}

export async function capabilitiesFor(
  installationId: string,
): Promise<{ capabilities: TeamCapabilities; installation: Awaited<ReturnType<typeof fetchInstallation>> }> {
  try {
    const installation = await fetchInstallation(installationId);
    return {
      installation,
      capabilities: buildTeamCapabilities(permissionMap(installation)),
    };
  } catch (err) {
    throw toGitHubAppError(err, "Lecture des permissions de la GitHub App");
  }
}

export function mapTeam(local: {
  id: string;
  githubTeamId: string;
  installationId: string;
  orgLogin: string;
  slug: string;
  name: string;
  description: string | null;
  privacy: string;
  parentTeamId: string | null;
  parentTeamSlug: string | null;
  htmlUrl: string;
  membersCount: number | null;
  reposCount: number | null;
  syncState: string;
  lastSyncedAt: Date;
}) {
  return {
    id: local.id,
    githubTeamId: local.githubTeamId,
    installationId: local.installationId,
    orgLogin: local.orgLogin,
    slug: local.slug,
    name: local.name,
    description: local.description,
    privacy: local.privacy,
    parentTeamId: local.parentTeamId,
    parentTeamSlug: local.parentTeamSlug,
    htmlUrl: local.htmlUrl,
    membersCount: local.membersCount,
    reposCount: local.reposCount,
    syncState: local.syncState,
    lastSyncedAt: local.lastSyncedAt,
  };
}

async function upsertTeam(
  installationDbId: string,
  orgLogin: string,
  team: GitHubTeamPayload,
) {
  const data = {
    orgLogin,
    slug: team.slug,
    name: team.name,
    description: team.description ?? null,
    privacy: team.privacy ?? "closed",
    parentTeamId: team.parent ? String(team.parent.id) : null,
    parentTeamSlug: team.parent?.slug ?? null,
    htmlUrl: team.html_url,
    membersCount:
      typeof team.members_count === "number" ? team.members_count : null,
    reposCount: typeof team.repos_count === "number" ? team.repos_count : null,
    syncState: "SYNCED" as const,
    lastSyncedAt: new Date(),
  };

  return prisma.gitHubTeam.upsert({
    where: {
      installationId_githubTeamId: {
        installationId: installationDbId,
        githubTeamId: String(team.id),
      },
    },
    create: {
      installationId: installationDbId,
      githubTeamId: String(team.id),
      ...data,
    },
    update: data,
  });
}

/**
 * Récupère TOUTES les équipes de l'organisation (borné à 1000).
 * `complete` indique si la dernière page a bien été atteinte : on ne
 * marque jamais des équipes comme supprimées sur une lecture partielle.
 */
async function fetchAllTeams(octokit: Octokit, org: string) {
  const teams: GitHubTeamPayload[] = [];
  let complete = false;

  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    let data: GitHubTeamPayload[];
    try {
      const response = await octokit.teams.list({
        org,
        per_page: PER_PAGE,
        page,
      });
      data = response.data as unknown as GitHubTeamPayload[];
    } catch (err) {
      throw toGitHubAppError(err, "Récupération des équipes GitHub");
    }

    teams.push(...data);
    if (data.length < PER_PAGE) {
      complete = true;
      break;
    }
  }

  return { teams, complete };
}

/**
 * Synchronise le cache local des équipes. GitHub reste la source de vérité :
 * les équipes absentes de la réponse complète passent en DELETED, sans
 * supprimer les associations de projet (traçabilité).
 */
async function syncTeamsCache(
  installation: InstallationRow,
  octokit: Octokit,
  reconcile: boolean,
) {
  const { teams, complete } = await fetchAllTeams(
    octokit,
    installation.accountLogin,
  );

  const locals = [];
  for (const team of teams) {
    locals.push(await upsertTeam(installation.id, installation.accountLogin, team));
  }

  if (reconcile && complete) {
    const ids = teams.map((team) => String(team.id));
    await prisma.gitHubTeam.updateMany({
      where: {
        installationId: installation.id,
        githubTeamId: { notIn: ids },
        syncState: { not: "DELETED" },
      },
      data: { syncState: "DELETED", lastSyncedAt: new Date() },
    });
  }

  return { locals, complete, githubCount: teams.length };
}

// ============================================================
// ORGANISATIONS
// ============================================================

export async function listOrganizations(userId: string) {
  const installations = await prisma.gitHubInstallation.findMany({
    where: { userId, revokedAt: null, accountType: "Organization" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      installationId: true,
      accountLogin: true,
      accountId: true,
      suspendedAt: true,
      lastOrgSyncedAt: true,
      orgSyncState: true,
      createdAt: true,
      _count: { select: { repositories: true, teams: true } },
    },
  });

  const organizations = await Promise.all(
    installations.map(async (installation) => {
      const base = {
        id: installation.id,
        installationId: installation.installationId,
        login: installation.accountLogin,
        githubOrgId: installation.accountId,
        htmlUrl: `https://github.com/${installation.accountLogin}`,
        avatarUrl: null as string | null,
        description: null as string | null,
        suspendedAt: installation.suspendedAt,
        lastOrgSyncedAt: installation.lastOrgSyncedAt,
        orgSyncState: installation.orgSyncState,
        repositoryCount: installation._count.repositories,
        teamCount: installation._count.teams,
        createdAt: installation.createdAt,
      };

      try {
        const gh = await fetchInstallation(installation.installationId);
        const account = (gh.account ?? {}) as {
          avatar_url?: string;
          html_url?: string;
          description?: string | null;
        };
        const capabilities = buildTeamCapabilities(permissionMap(gh));
        return {
          ...base,
          avatarUrl: account.avatar_url ?? null,
          description: account.description ?? null,
          capabilities,
          error: null as string | null,
        };
      } catch (err) {
        const appError = toGitHubAppError(
          err,
          "Lecture des permissions de l'organisation GitHub",
        );
        return {
          ...base,
          capabilities: buildTeamCapabilities({}),
          error: appError.message,
        };
      }
    }),
  );

  return organizations;
}

export async function syncOrganization(
  userId: string,
  installationId: string,
) {
  const installation = await loadInstallation(userId, installationId);
  const { capabilities } = await capabilitiesFor(installation.installationId);

  if (!capabilities.canReadTeams) {
    throw permissionRequiredError(
      "Synchronisation de l'organisation",
      capabilities.missingPermissions,
    );
  }

  const octokit = await getInstallationOctokit(installation.installationId);

  let org: {
    id: number;
    login: string;
    html_url?: string;
    avatar_url?: string;
    name?: string | null;
    description?: string | null;
  };
  try {
    const { data } = await octokit.orgs.get({ org: installation.accountLogin });
    org = data as unknown as typeof org;
  } catch (err) {
    throw toGitHubAppError(err, "Lecture de l'organisation GitHub");
  }

  try {
    const sync = await syncTeamsCache(installation, octokit, true);

    await prisma.gitHubInstallation.update({
      where: { id: installation.id },
      data: { lastOrgSyncedAt: new Date(), orgSyncState: "SYNCED" },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: "GITHUB_ORGANIZATION_SYNCED",
        targetType: "GitHubInstallation",
        targetId: installation.id,
        metadataJson: {
          org: installation.accountLogin,
          teams: sync.githubCount,
          complete: sync.complete,
        },
      },
    });

    logger.info(
      { userId, installationId, teams: sync.githubCount },
      "Organisation GitHub synchronisée",
    );

    return {
      organization: {
        id: installation.id,
        installationId: installation.installationId,
        login: installation.accountLogin,
        githubOrgId: String(org.id ?? installation.accountId),
        name: org.name ?? null,
        description: org.description ?? null,
        htmlUrl: org.html_url ?? `https://github.com/${installation.accountLogin}`,
        avatarUrl: org.avatar_url ?? null,
        lastOrgSyncedAt: new Date(),
        orgSyncState: "SYNCED",
        capabilities,
      },
      teamsSynced: sync.githubCount,
      complete: sync.complete,
    };
  } catch (err) {
    await prisma.gitHubInstallation.update({
      where: { id: installation.id },
      data: { orgSyncState: "ERROR" },
    });
    throw err;
  }
}

// ============================================================
// ÉQUIPES
// ============================================================

export interface ListTeamsFilters {
  search?: string;
  privacy?: "secret" | "closed";
  page: number;
  pageSize: number;
}

export async function listTeams(
  userId: string,
  installationId: string,
  filters: ListTeamsFilters,
) {
  const installation = await loadInstallation(userId, installationId);
  const { capabilities } = await capabilitiesFor(installation.installationId);

  if (!capabilities.canReadTeams) {
    throw permissionRequiredError(
      "Affichage des équipes",
      capabilities.missingPermissions,
    );
  }

  const octokit = await getInstallationOctokit(installation.installationId);
  const sync = await syncTeamsCache(installation, octokit, true);

  const search = filters.search?.trim().toLowerCase();
  const filtered = sync.locals.filter((team) => {
    if (filters.privacy && team.privacy !== filters.privacy) return false;
    if (!search) return true;
    return (
      team.name.toLowerCase().includes(search) ||
      team.slug.toLowerCase().includes(search) ||
      (team.description ?? "").toLowerCase().includes(search)
    );
  });

  const total = filtered.length;
  const start = (filters.page - 1) * filters.pageSize;
  const items = filtered
    .slice(start, start + filters.pageSize)
    .map((team) => mapTeam(team));

  return {
    items,
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    complete: sync.complete,
    capabilities,
    organization: {
      login: installation.accountLogin,
      installationId: installation.installationId,
      htmlUrl: `https://github.com/${installation.accountLogin}`,
      lastOrgSyncedAt: installation.lastOrgSyncedAt,
      orgSyncState: installation.orgSyncState,
    },
  };
}

export async function getTeam(
  userId: string,
  installationId: string,
  slug: string,
) {
  const installation = await loadInstallation(userId, installationId);
  const { capabilities } = await capabilitiesFor(installation.installationId);

  if (!capabilities.canReadTeams) {
    throw permissionRequiredError(
      "Affichage de l'équipe",
      capabilities.missingPermissions,
    );
  }

  const octokit = await getInstallationOctokit(installation.installationId);
  let payload: GitHubTeamPayload;
  try {
    const { data } = await octokit.teams.getByName({
      org: installation.accountLogin,
      team_slug: slug,
    });
    payload = data as unknown as GitHubTeamPayload;
  } catch (err) {
    throw toGitHubAppError(err, "Lecture de l'équipe GitHub");
  }

  const local = await upsertTeam(
    installation.id,
    installation.accountLogin,
    payload,
  );

  return { team: mapTeam(local), capabilities };
}

export async function syncTeam(
  userId: string,
  installationId: string,
  slug: string,
) {
  const result = await getTeam(userId, installationId, slug);

  await prisma.auditLog.create({
    data: {
      userId,
      action: "GITHUB_TEAM_SYNCED",
      targetType: "GitHubTeam",
      targetId: result.team.id,
      metadataJson: {
        org: result.team.orgLogin,
        slug: result.team.slug,
        githubTeamId: result.team.githubTeamId,
      },
    },
  });

  return result;
}

export interface CreateTeamInput {
  name: string;
  description?: string;
  privacy: "secret" | "closed";
  parentTeamId?: string;
  maintainers?: string[];
  repoFullNames?: string[];
  notificationSetting?:
    | "notifications_enabled"
    | "notifications_disabled";
}

export async function createTeam(
  userId: string,
  installationId: string,
  input: CreateTeamInput,
) {
  const installation = await loadInstallation(userId, installationId);
  const { capabilities } = await capabilitiesFor(installation.installationId);

  if (!capabilities.canWriteTeams) {
    throw permissionRequiredError("Création d'une équipe", ["Members: write"]);
  }

  const octokit = await getInstallationOctokit(installation.installationId);

  let parentTeamId: number | undefined;
  if (input.parentTeamId) {
    const parent = await prisma.gitHubTeam.findFirst({
      where: {
        installationId: installation.id,
        githubTeamId: input.parentTeamId,
        syncState: { not: "DELETED" },
      },
      select: { githubTeamId: true },
    });
    if (!parent) {
      throw new BadRequestError(
        "L'équipe parente sélectionnée n'existe pas dans cette organisation ou n'est plus accessible.",
      );
    }
    parentTeamId = Number(parent.githubTeamId);
  }

  const repoFullNames = input.repoFullNames ?? [];
  if (repoFullNames.length > 0) {
    const prefix = `${installation.accountLogin.toLowerCase()}/`;
    const invalid = repoFullNames.filter(
      (fullName) => !fullName.toLowerCase().startsWith(prefix),
    );
    if (invalid.length > 0) {
      throw new BadRequestError(
        `Un dépôt associé doit appartenir à l'organisation ${installation.accountLogin} : ${invalid.join(", ")}.`,
      );
    }

    const known = await prisma.gitHubRepository.findMany({
      where: {
        installationId: installation.id,
        fullName: { in: repoFullNames },
      },
      select: { fullName: true },
    });
    const knownSet = new Set(known.map((repo) => repo.fullName.toLowerCase()));
    const missing = repoFullNames.filter(
      (fullName) => !knownSet.has(fullName.toLowerCase()),
    );
    if (missing.length > 0) {
      throw new BadRequestError(
        `Ces dépôts ne sont pas accessibles à l'installation GitHub : ${missing.join(", ")}.`,
      );
    }
  }

  let payload: GitHubTeamPayload;
  try {
    const { data } = await octokit.teams.create({
      org: installation.accountLogin,
      name: input.name,
      description: input.description,
      privacy: input.privacy,
      parent_team_id: parentTeamId,
      maintainers: input.maintainers,
      repo_names: repoFullNames.length > 0 ? repoFullNames : undefined,
      notification_setting: input.notificationSetting,
    });
    payload = data as unknown as GitHubTeamPayload;
  } catch (err) {
    throw toGitHubAppError(err, "Création de l'équipe GitHub");
  }

  if (!payload?.id || !payload?.slug) {
    throw toGitHubAppError(
      new Error("Réponse GitHub incomplète après création de l'équipe"),
      "Création de l'équipe GitHub",
    );
  }

  const local = await upsertTeam(
    installation.id,
    installation.accountLogin,
    payload,
  );

  await prisma.auditLog.create({
    data: {
      userId,
      action: "GITHUB_TEAM_CREATED",
      targetType: "GitHubTeam",
      targetId: local.id,
      metadataJson: {
        org: installation.accountLogin,
        slug: local.slug,
        githubTeamId: local.githubTeamId,
        privacy: local.privacy,
        parentTeamId: local.parentTeamId,
        maintainers: input.maintainers ?? [],
        repoFullNames,
      },
    },
  });

  logger.info(
    {
      userId,
      installationId,
      org: installation.accountLogin,
      slug: local.slug,
    },
    "Équipe GitHub créée",
  );

  return { team: mapTeam(local), capabilities };
}

// ============================================================
// MEMBRES
// ============================================================

export interface ListMembersFilters {
  page: number;
  pageSize: number;
  role?: "member" | "maintainer";
}

interface GitHubInvitationPayload {
  id: number;
  login: string;
  role: string;
  created_at?: string;
  html_url?: string;
  avatar_url?: string;
}

async function fetchAllTeamMembers(
  octokit: Octokit,
  org: string,
  slug: string,
  role?: "member" | "maintainer",
) {
  const members: GitHubUserPayload[] = [];
  let complete = false;

  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    let data: GitHubUserPayload[];
    try {
      const response = await octokit.teams.listMembersInOrg({
        org,
        team_slug: slug,
        role,
        per_page: PER_PAGE,
        page,
      });
      data = response.data as unknown as GitHubUserPayload[];
    } catch (err) {
      throw toGitHubAppError(err, "Récupération des membres de l'équipe");
    }

    members.push(...data);
    if (data.length < PER_PAGE) {
      complete = true;
      break;
    }
  }

  return { members, complete };
}

export async function listMembers(
  userId: string,
  installationId: string,
  slug: string,
  filters: ListMembersFilters,
) {
  const installation = await loadInstallation(userId, installationId);
  const { capabilities } = await capabilitiesFor(installation.installationId);

  if (!capabilities.canReadTeams) {
    throw permissionRequiredError(
      "Affichage des membres",
      capabilities.missingPermissions,
    );
  }

  const octokit = await getInstallationOctokit(installation.installationId);

  const [all, maintainers] = await Promise.all([
    fetchAllTeamMembers(octokit, installation.accountLogin, slug),
    fetchAllTeamMembers(octokit, installation.accountLogin, slug, "maintainer"),
  ]);

  const maintainerLogins = new Set(
    maintainers.members.map((member) => member.login.toLowerCase()),
  );

  const mapped = all.members.map((member) => ({
    id: String(member.id),
    login: member.login,
    avatarUrl: member.avatar_url,
    htmlUrl: member.html_url,
    role: maintainerLogins.has(member.login.toLowerCase())
      ? ("maintainer" as const)
      : ("member" as const),
    state: "active" as const,
    source: "direct" as const,
  }));

  const filtered = filters.role
    ? mapped.filter((member) => member.role === filters.role)
    : mapped;

  const total = filtered.length;
  const start = (filters.page - 1) * filters.pageSize;
  const items = filtered.slice(start, start + filters.pageSize);

  let pendingInvitations: Array<{
    id: string;
    login: string;
    avatarUrl: string | null;
    htmlUrl: string | null;
    role: "member" | "maintainer";
    state: "pending";
    createdAt: string | null;
  }> = [];

  try {
    const { data } = await octokit.teams.listPendingInvitationsInOrg({
      org: installation.accountLogin,
      team_slug: slug,
      per_page: PER_PAGE,
      page: 1,
    });
    pendingInvitations = (data as unknown as GitHubInvitationPayload[])
      .filter(
        (invitation) =>
          !mapped.some(
            (member) =>
              member.login.toLowerCase() === invitation.login.toLowerCase(),
          ),
      )
      .map((invitation) => ({
        id: String(invitation.id),
        login: invitation.login,
        avatarUrl: invitation.avatar_url ?? null,
        htmlUrl: invitation.html_url ?? null,
        role:
          invitation.role === "maintainer"
            ? ("maintainer" as const)
            : ("member" as const),
        state: "pending" as const,
        createdAt: invitation.created_at ?? null,
      }));
  } catch (err) {
    // L'endpoint des invitations peut être refusé selon les permissions :
    // on ne bloque pas l'affichage des membres actifs pour autant.
    const details = err as { status?: number };
    if (details.status !== 403 && details.status !== 404) {
      throw toGitHubAppError(
        err,
        "Récupération des invitations en attente de l'équipe",
      );
    }
  }

  return {
    items,
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    complete: all.complete,
    pendingInvitations,
    capabilities,
  };
}

export async function addMember(
  userId: string,
  installationId: string,
  slug: string,
  input: { username: string; role: "member" | "maintainer" },
) {
  const installation = await loadInstallation(userId, installationId);
  const { capabilities } = await capabilitiesFor(installation.installationId);

  if (!capabilities.canWriteTeams) {
    throw permissionRequiredError("Ajout d'un membre", ["Members: write"]);
  }

  const octokit = await getInstallationOctokit(installation.installationId);

  let data: { role?: string; state?: string };
  try {
    const response = await octokit.teams.addOrUpdateMembershipForUserInOrg({
      org: installation.accountLogin,
      team_slug: slug,
      username: input.username,
      role: input.role,
    });
    data = response.data as unknown as typeof data;
  } catch (err) {
    throw toGitHubAppError(
      err,
      `Ajout de « ${input.username} » à l'équipe`,
    );
  }

  if (data.state !== "active" && data.state !== "pending") {
    throw toGitHubAppError(
      new Error("GitHub n'a pas confirmé l'ajout du membre"),
      `Ajout de « ${input.username} » à l'équipe`,
    );
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action: "GITHUB_TEAM_MEMBER_ADDED",
      targetType: "GitHubTeam",
      targetId: `${installation.accountLogin}/${slug}`,
      metadataJson: {
        username: input.username,
        role: data.role ?? input.role,
        state: data.state,
      },
    },
  });

  return {
    username: input.username,
    role: data.role ?? input.role,
    state: data.state,
    message:
      data.state === "pending"
        ? `Invitation en attente : « ${input.username} » doit accepter l'invitation GitHub avant de devenir membre actif.`
        : `« ${input.username} » a été ajouté à l'équipe.`,
  };
}

export async function removeMember(
  userId: string,
  installationId: string,
  slug: string,
  username: string,
) {
  const installation = await loadInstallation(userId, installationId);
  const { capabilities } = await capabilitiesFor(installation.installationId);

  if (!capabilities.canWriteTeams) {
    throw permissionRequiredError("Retrait d'un membre", ["Members: write"]);
  }

  const octokit = await getInstallationOctokit(installation.installationId);

  try {
    await octokit.teams.removeMembershipForUserInOrg({
      org: installation.accountLogin,
      team_slug: slug,
      username,
    });
  } catch (err) {
    throw toGitHubAppError(
      err,
      `Retrait de « ${username} » de l'équipe`,
    );
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action: "GITHUB_TEAM_MEMBER_REMOVED",
      targetType: "GitHubTeam",
      targetId: `${installation.accountLogin}/${slug}`,
      metadataJson: { username },
    },
  });

  return { username, removed: true };
}
