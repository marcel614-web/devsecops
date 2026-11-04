// apps/api/src/modules/github/team-repos.service.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../../utils/prisma";
import { resetDatabase, createUser } from "../../test/helpers";

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
  listAvailableRepos,
  listTeamRepos,
  removeTeamRepo,
  setRepoPermission,
} from "./team-repos.service";
import { AppError } from "../../utils/errors";

function makeOctokit() {
  return {
    teams: {
      listReposInOrg: vi.fn(),
      addOrUpdateRepoPermissionsInOrg: vi.fn(),
      removeRepoInOrg: vi.fn(),
      checkPermissionsForRepoInOrg: vi.fn(),
    },
  };
}

type OctokitMock = ReturnType<typeof makeOctokit>;

async function setup(options: {
  permissions?: Record<string, string>;
  withRepo?: boolean;
}) {
  const user = await createUser({ role: "ADMIN" });
  const installation = await prisma.gitHubInstallation.create({
    data: {
      installationId: "55555",
      accountLogin: "acme-org",
      accountType: "Organization",
      accountId: "999",
      targetType: "Organization",
      userId: user.id,
    },
  });

  if (options.withRepo !== false) {
    await prisma.gitHubRepository.create({
      data: {
        repositoryId: "1001",
        fullName: "acme-org/api",
        owner: "acme-org",
        name: "api",
        private: true,
        htmlUrl: "https://github.com/acme-org/api",
        installationId: installation.id,
      },
    });
  }

  vi.mocked(fetchInstallation).mockResolvedValue({
    id: 55555,
    account: { login: "acme-org", id: 999, type: "Organization" },
    target_type: "Organization",
    permissions: options.permissions ?? {
      members: "write",
      administration: "write",
      metadata: "read",
    },
  } as never);

  const octokit = makeOctokit();
  vi.mocked(getInstallationOctokit).mockResolvedValue(octokit as never);
  return { user, installation, octokit };
}

function repoPayload() {
  return {
    id: 1001,
    full_name: "acme-org/api",
    name: "api",
    owner: { login: "acme-org" },
    private: true,
    html_url: "https://github.com/acme-org/api",
    description: "API de test",
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

describe("team-repos.service", () => {
  it("liste les dépôts associés avec leur permission GitHub", async () => {
    const { user, installation, octokit } = await setup({});
    octokit.teams.listReposInOrg.mockResolvedValue({
      data: [repoPayload()],
    });
    octokit.teams.checkPermissionsForRepoInOrg.mockResolvedValue({
      data: { permission: "push", role_name: "push" },
    });

    const result = await listTeamRepos(
      user.id,
      installation.installationId,
      "security",
      { page: 1, pageSize: 30 },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].fullName).toBe("acme-org/api");
    expect(result.items[0].permission).toBe("push");
  });

  it("associe un dépôt et vérifie la permission réellement appliquée", async () => {
    const { user, installation, octokit } = await setup({});
    octokit.teams.addOrUpdateRepoPermissionsInOrg.mockResolvedValue({});
    octokit.teams.checkPermissionsForRepoInOrg.mockResolvedValue({
      data: { permission: "push" },
    });

    const result = await setRepoPermission(
      user.id,
      installation.installationId,
      "security",
      { owner: "acme-org", repo: "api", permission: "push" },
    );

    expect(result.repository).toBe("acme-org/api");
    expect(result.permission).toBe("push");
    expect(result.verified).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "GITHUB_TEAM_REPO_PERMISSION_SET" },
    });
    expect(audit).not.toBeNull();
  });

  it("refuse une modification sans Administration: write", async () => {
    const { user, installation, octokit } = await setup({
      permissions: { members: "write", metadata: "read" },
    });

    await expectAppError(
      setRepoPermission(user.id, installation.installationId, "security", {
        owner: "acme-org",
        repo: "api",
        permission: "admin",
      }),
      403,
      "GITHUB_PERMISSION_MISSING",
    );
    expect(octokit.teams.addOrUpdateRepoPermissionsInOrg).not.toHaveBeenCalled();
  });

  it("refuse un dépôt hors organisation ou inaccessible à l'installation", async () => {
    const { user, installation, octokit } = await setup({ withRepo: false });

    await expectAppError(
      setRepoPermission(user.id, installation.installationId, "security", {
        owner: "acme-org",
        repo: "inconnu",
        permission: "push",
      }),
      400,
      "BAD_REQUEST",
    );
    expect(octokit.teams.addOrUpdateRepoPermissionsInOrg).not.toHaveBeenCalled();
  });

  it("retire un dépôt de l'équipe et journalise l'action", async () => {
    const { user, installation, octokit } = await setup({});
    octokit.teams.removeRepoInOrg.mockResolvedValue({});

    const result = await removeTeamRepo(
      user.id,
      installation.installationId,
      "security",
      "acme-org",
      "api",
    );

    expect(result.removed).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "GITHUB_TEAM_REPO_REMOVED" },
    });
    expect(audit).not.toBeNull();
  });

  it("liste les dépôts de l'organisation disponibles pour l'association", async () => {
    const { user, installation } = await setup({});

    const result = await listAvailableRepos(
      user.id,
      installation.installationId,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].fullName).toBe("acme-org/api");
  });

  it("traduit un rate limit GitHub lors de la lecture des dépôts", async () => {
    const { user, installation, octokit } = await setup({});
    octokit.teams.listReposInOrg.mockRejectedValue({
      status: 429,
      response: {
        status: 429,
        headers: { "retry-after": "30" },
        data: { message: "API rate limit exceeded" },
      },
    });

    const appError = await expectAppError(
      listTeamRepos(user.id, installation.installationId, "security", {
        page: 1,
        pageSize: 30,
      }),
      429,
      "GITHUB_RATE_LIMITED",
    );
    expect(appError.details).toMatchObject({ retryAfterSeconds: 30 });
  });
});
