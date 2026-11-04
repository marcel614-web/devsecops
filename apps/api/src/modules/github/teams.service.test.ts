// apps/api/src/modules/github/teams.service.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../../utils/prisma";
import { resetDatabase, createUser } from "../../test/helpers";

/**
 * Les appels réseau GitHub sont mockés : on teste la logique métier,
 * la persistance du cache, les permissions et la traduction des erreurs.
 * La base utilisée est la base de TEST (cf. src/test/setup.ts).
 */
vi.mock("./github-app.service", () => ({
  fetchInstallation: vi.fn(),
  getInstallationOctokit: vi.fn(),
  invalidateInstallationToken: vi.fn(),
}));

import {
  fetchInstallation,
  getInstallationOctokit,
} from "./github-app.service";
import {
  addMember,
  createTeam,
  getTeam,
  listMembers,
  listOrganizations,
  listTeams,
  removeMember,
  syncOrganization,
} from "./teams.service";
import { AppError } from "../../utils/errors";

function makeOctokit() {
  return {
    teams: {
      list: vi.fn(),
      getByName: vi.fn(),
      create: vi.fn(),
      listMembersInOrg: vi.fn(),
      addOrUpdateMembershipForUserInOrg: vi.fn(),
      removeMembershipForUserInOrg: vi.fn(),
      listPendingInvitationsInOrg: vi.fn(),
      listReposInOrg: vi.fn(),
      addOrUpdateRepoPermissionsInOrg: vi.fn(),
      removeRepoInOrg: vi.fn(),
      checkPermissionsForRepoInOrg: vi.fn(),
    },
    orgs: {
      get: vi.fn(),
    },
  };
}

type OctokitMock = ReturnType<typeof makeOctokit>;

interface SetupOptions {
  userId: string;
  installationId?: string;
  accountLogin?: string;
  accountType?: string;
  permissions?: Record<string, string>;
}

async function setupInstallation(options: SetupOptions) {
  const installation = await prisma.gitHubInstallation.create({
    data: {
      installationId: options.installationId ?? "12345",
      accountLogin: options.accountLogin ?? "acme-org",
      accountType: options.accountType ?? "Organization",
      accountId: "999",
      targetType: options.accountType ?? "Organization",
      userId: options.userId,
    },
  });

  vi.mocked(fetchInstallation).mockResolvedValue({
    id: Number(installation.installationId),
    account: {
      login: installation.accountLogin,
      id: 999,
      type: installation.accountType,
      avatar_url: "https://avatars.example/org.png",
      html_url: `https://github.com/${installation.accountLogin}`,
      description: "Organisation de test",
    },
    target_type: installation.accountType,
    permissions: options.permissions ?? {
      members: "write",
      administration: "write",
      metadata: "read",
    },
  } as never);

  const octokit = makeOctokit();
  vi.mocked(getInstallationOctokit).mockResolvedValue(octokit as never);
  return { installation, octokit };
}

function teamPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: "Security",
    slug: "security",
    description: "Équipe sécurité",
    privacy: "closed",
    html_url: "https://github.com/orgs/acme-org/teams/security",
    members_count: 3,
    repos_count: 2,
    parent: null,
    ...overrides,
  };
}

async function expectAppError(
  promise: Promise<unknown>,
  statusCode: number,
  code: string,
) {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  try {
    await promise;
  } catch (err) {
    const appError = err as AppError;
    expect(appError.statusCode).toBe(statusCode);
    expect(appError.code).toBe(code);
    return appError;
  }
  throw new Error("Erreur attendue non levée");
}

beforeEach(async () => {
  await resetDatabase();
  vi.resetAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("listOrganizations", () => {
  it("ne retourne que les installations de type Organisation", async () => {
    const user = await createUser();
    await setupInstallation({ userId: user.id, installationId: "111" });
    await setupInstallation({
      userId: user.id,
      installationId: "222",
      accountLogin: "personal-account",
      accountType: "User",
    });

    const organizations = await listOrganizations(user.id);

    expect(organizations).toHaveLength(1);
    expect(organizations[0].login).toBe("acme-org");
    expect(organizations[0].capabilities.canReadTeams).toBe(true);
    expect(organizations[0].capabilities.canWriteTeams).toBe(true);
    expect(organizations[0].capabilities.canManageRepoPermissions).toBe(true);
  });

  it("signale les permissions manquantes sans masquer l'organisation", async () => {
    const user = await createUser();
    await setupInstallation({
      userId: user.id,
      permissions: { metadata: "read" },
    });

    const organizations = await listOrganizations(user.id);

    expect(organizations).toHaveLength(1);
    expect(organizations[0].capabilities.canReadTeams).toBe(false);
    expect(organizations[0].capabilities.missingPermissions).toContain(
      "Members: read",
    );
  });
});

describe("listTeams", () => {
  it("pagine et met en cache les équipes GitHub", async () => {
    const user = await createUser();
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    octokit.teams.list.mockResolvedValue({
      data: [
        teamPayload({ id: 1, name: "Security", slug: "security" }),
        teamPayload({ id: 2, name: "Platform", slug: "platform" }),
      ],
    });

    const page = await listTeams(user.id, installation.installationId, {
      page: 1,
      pageSize: 1,
    });

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.totalPages).toBe(2);
    expect(page.capabilities.canReadTeams).toBe(true);

    const cached = await prisma.gitHubTeam.findMany({
      where: { installationId: installation.id },
      orderBy: { githubTeamId: "asc" },
    });
    expect(cached).toHaveLength(2);
    expect(cached.every((team) => team.syncState === "SYNCED")).toBe(true);
  });

  it("filtre par nom, slug et visibilité", async () => {
    const user = await createUser();
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    octokit.teams.list.mockResolvedValue({
      data: [
        teamPayload({ id: 1, name: "Security", slug: "security" }),
        teamPayload({
          id: 2,
          name: "Platform",
          slug: "platform",
          privacy: "secret",
        }),
      ],
    });

    const search = await listTeams(user.id, installation.installationId, {
      page: 1,
      pageSize: 30,
      search: "plat",
    });
    expect(search.total).toBe(1);
    expect(search.items[0].slug).toBe("platform");

    const secret = await listTeams(user.id, installation.installationId, {
      page: 1,
      pageSize: 30,
      privacy: "secret",
    });
    expect(secret.total).toBe(1);
    expect(secret.items[0].slug).toBe("platform");
  });

  it("marque comme DELETED les équipes supprimées sur GitHub", async () => {
    const user = await createUser();
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    await prisma.gitHubTeam.create({
      data: {
        installationId: installation.id,
        githubTeamId: "999",
        orgLogin: "acme-org",
        slug: "ancienne-equipe",
        name: "Ancienne équipe",
        privacy: "closed",
        htmlUrl: "https://github.com/orgs/acme-org/teams/ancienne-equipe",
      },
    });
    octokit.teams.list.mockResolvedValue({
      data: [teamPayload({ id: 1, name: "Security", slug: "security" })],
    });

    await listTeams(user.id, installation.installationId, {
      page: 1,
      pageSize: 30,
    });

    const deleted = await prisma.gitHubTeam.findFirst({
      where: { githubTeamId: "999" },
    });
    expect(deleted?.syncState).toBe("DELETED");
  });

  it("refuse une installation appartenant à un autre utilisateur", async () => {
    const owner = await createUser({ email: "owner@test.local" });
    const other = await createUser({ email: "other@test.local" });
    const { installation } = await setupInstallation({ userId: owner.id });

    await expectAppError(
      listTeams(other.id, installation.installationId, {
        page: 1,
        pageSize: 30,
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("refuse les comptes personnels pour les équipes", async () => {
    const user = await createUser();
    const { installation } = await setupInstallation({
      userId: user.id,
      accountType: "User",
      accountLogin: "personal-account",
    });

    await expectAppError(
      listTeams(user.id, installation.installationId, {
        page: 1,
        pageSize: 30,
      }),
      400,
      "BAD_REQUEST",
    );
  });

  it("traduit un rate limit GitHub en 429 avec Retry-After", async () => {
    const user = await createUser();
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    octokit.teams.list.mockRejectedValue({
      status: 429,
      response: {
        status: 429,
        headers: { "retry-after": "60" },
        data: { message: "API rate limit exceeded" },
      },
    });

    const appError = await expectAppError(
      listTeams(user.id, installation.installationId, {
        page: 1,
        pageSize: 30,
      }),
      429,
      "GITHUB_RATE_LIMITED",
    );
    expect(appError.details).toMatchObject({ retryAfterSeconds: 60 });
  });

  it("traduit un délai dépassé en 504 sans masquer l'échec", async () => {
    const user = await createUser();
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    octokit.teams.list.mockRejectedValue({
      name: "AbortError",
      message: "GitHub API request timed out",
    });

    await expectAppError(
      listTeams(user.id, installation.installationId, {
        page: 1,
        pageSize: 30,
      }),
      504,
      "GITHUB_TIMEOUT",
    );
  });
});

describe("getTeam et synchronisation d'organisation", () => {
  it("récupère une équipe et la met en cache", async () => {
    const user = await createUser();
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    octokit.teams.getByName.mockResolvedValue({
      data: teamPayload({ id: 7, name: "Security", slug: "security" }),
    });

    const result = await getTeam(
      user.id,
      installation.installationId,
      "security",
    );

    expect(result.team.githubTeamId).toBe("7");
    expect(result.team.slug).toBe("security");
    expect(octokit.teams.getByName).toHaveBeenCalledWith({
      org: "acme-org",
      team_slug: "security",
    });
    const cached = await prisma.gitHubTeam.findFirst({
      where: { githubTeamId: "7" },
    });
    expect(cached?.name).toBe("Security");
  });

  it("synchronise l'organisation et ses équipes", async () => {
    const user = await createUser();
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    octokit.orgs.get.mockResolvedValue({
      data: {
        id: 999,
        login: "acme-org",
        name: "ACME",
        description: "Organisation de test",
        html_url: "https://github.com/acme-org",
        avatar_url: "https://avatars.example/org.png",
      },
    });
    octokit.teams.list.mockResolvedValue({
      data: [teamPayload({ id: 1, name: "Security", slug: "security" })],
    });

    const result = await syncOrganization(
      user.id,
      installation.installationId,
    );

    expect(result.teamsSynced).toBe(1);
    expect(result.complete).toBe(true);
    const updated = await prisma.gitHubInstallation.findUnique({
      where: { id: installation.id },
    });
    expect(updated?.orgSyncState).toBe("SYNCED");
    expect(updated?.lastOrgSyncedAt).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: "GITHUB_ORGANIZATION_SYNCED" },
    });
    expect(audit).not.toBeNull();
  });
});

describe("createTeam", () => {
  it("crée réellement l'équipe sur GitHub et journalise l'action", async () => {
    const user = await createUser({ role: "ADMIN" });
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    octokit.teams.create.mockResolvedValue({
      data: teamPayload({
        id: 77,
        name: "Nouvelle équipe",
        slug: "nouvelle-equipe",
        privacy: "secret",
      }),
    });

    const result = await createTeam(user.id, installation.installationId, {
      name: "Nouvelle équipe",
      description: "Description",
      privacy: "secret",
    });

    expect(result.team.githubTeamId).toBe("77");
    expect(result.team.slug).toBe("nouvelle-equipe");
    expect(octokit.teams.create).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "acme-org",
        name: "Nouvelle équipe",
        privacy: "secret",
      }),
    );

    const cached = await prisma.gitHubTeam.findFirst({
      where: { githubTeamId: "77" },
    });
    expect(cached?.syncState).toBe("SYNCED");
    const audit = await prisma.auditLog.findFirst({
      where: { action: "GITHUB_TEAM_CREATED" },
    });
    expect(audit).not.toBeNull();
  });

  it("ne crée rien et remonte l'erreur réelle quand GitHub refuse", async () => {
    const user = await createUser({ role: "ADMIN" });
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    octokit.teams.create.mockRejectedValue({
      status: 422,
      response: {
        status: 422,
        data: { message: "Name has already been taken" },
      },
    });

    await expectAppError(
      createTeam(user.id, installation.installationId, {
        name: "Doublon",
        privacy: "closed",
      }),
      422,
      "GITHUB_UNPROCESSABLE",
    );

    expect(await prisma.gitHubTeam.count()).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { action: "GITHUB_TEAM_CREATED" } }),
    ).toBe(0);
  });

  it("refuse avant l'appel GitHub sans permission Members: write", async () => {
    const user = await createUser({ role: "ADMIN" });
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
      permissions: { members: "read", metadata: "read" },
    });

    await expectAppError(
      createTeam(user.id, installation.installationId, {
        name: "Sans permission",
        privacy: "closed",
      }),
      403,
      "GITHUB_PERMISSION_MISSING",
    );

    expect(octokit.teams.create).not.toHaveBeenCalled();
  });

  it("refuse une équipe parente inconnue dans l'organisation", async () => {
    const user = await createUser({ role: "ADMIN" });
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });

    await expectAppError(
      createTeam(user.id, installation.installationId, {
        name: "Enfant",
        privacy: "closed",
        parentTeamId: "404",
      }),
      400,
      "BAD_REQUEST",
    );
    expect(octokit.teams.create).not.toHaveBeenCalled();
  });
});

describe("membres d'équipe", () => {
  it("liste les membres actifs, les maintainers et les invitations en attente", async () => {
    const user = await createUser();
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    const alice = {
      id: 1,
      login: "alice",
      avatar_url: "https://avatars.example/alice.png",
      html_url: "https://github.com/alice",
    };
    const bob = {
      id: 2,
      login: "bob",
      avatar_url: "https://avatars.example/bob.png",
      html_url: "https://github.com/bob",
    };

    octokit.teams.listMembersInOrg.mockImplementation(
      async (params: { role?: string }) => {
        if (params.role === "maintainer") return { data: [alice] };
        return { data: [alice, bob] };
      },
    );
    octokit.teams.listPendingInvitationsInOrg.mockResolvedValue({
      data: [
        {
          id: 3,
          login: "carol",
          role: "member",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const result = await listMembers(
      user.id,
      installation.installationId,
      "security",
      { page: 1, pageSize: 30 },
    );

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    const aliceItem = result.items.find((member) => member.login === "alice");
    const bobItem = result.items.find((member) => member.login === "bob");
    expect(aliceItem?.role).toBe("maintainer");
    expect(bobItem?.role).toBe("member");
    expect(result.pendingInvitations).toHaveLength(1);
    expect(result.pendingInvitations[0].login).toBe("carol");
    expect(result.pendingInvitations[0].state).toBe("pending");
  });

  it("ajoute un membre actif et journalise l'action", async () => {
    const user = await createUser({ role: "ADMIN" });
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    octokit.teams.addOrUpdateMembershipForUserInOrg.mockResolvedValue({
      data: { role: "maintainer", state: "active" },
    });

    const result = await addMember(
      user.id,
      installation.installationId,
      "security",
      { username: "alice", role: "maintainer" },
    );

    expect(result.state).toBe("active");
    expect(result.role).toBe("maintainer");
    expect(octokit.teams.addOrUpdateMembershipForUserInOrg).toHaveBeenCalledWith(
      {
        org: "acme-org",
        team_slug: "security",
        username: "alice",
        role: "maintainer",
      },
    );
    const audit = await prisma.auditLog.findFirst({
      where: { action: "GITHUB_TEAM_MEMBER_ADDED" },
    });
    expect(audit).not.toBeNull();
  });

  it("affiche une invitation en attente sans prétendre que le membre est actif", async () => {
    const user = await createUser({ role: "ADMIN" });
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    octokit.teams.addOrUpdateMembershipForUserInOrg.mockResolvedValue({
      data: { role: "member", state: "pending" },
    });

    const result = await addMember(
      user.id,
      installation.installationId,
      "security",
      { username: "carol", role: "member" },
    );

    expect(result.state).toBe("pending");
    expect(result.message).toContain("Invitation en attente");
  });

  it("remonte un refus GitHub lors de l'ajout d'un membre", async () => {
    const user = await createUser({ role: "ADMIN" });
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    octokit.teams.addOrUpdateMembershipForUserInOrg.mockRejectedValue({
      status: 403,
      response: {
        status: 403,
        data: { message: "You do not have permission to add members" },
      },
    });

    await expectAppError(
      addMember(user.id, installation.installationId, "security", {
        username: "mallory",
        role: "member",
      }),
      403,
      "GITHUB_FORBIDDEN",
    );
  });

  it("retire un membre sur GitHub et journalise l'action", async () => {
    const user = await createUser({ role: "ADMIN" });
    const { installation, octokit } = await setupInstallation({
      userId: user.id,
    });
    octokit.teams.removeMembershipForUserInOrg.mockResolvedValue({});

    const result = await removeMember(
      user.id,
      installation.installationId,
      "security",
      "alice",
    );

    expect(result.removed).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "GITHUB_TEAM_MEMBER_REMOVED" },
    });
    expect(audit).not.toBeNull();
  });
});
