// apps/api/src/modules/github/teams.routes.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app";
import { prisma } from "../../utils/prisma";
import { resetDatabase, createUser } from "../../test/helpers";
import { setRateLimitsEnabledInTest } from "../../middleware/rateLimiter";

vi.mock("./github-app.service", () => ({
  fetchInstallation: vi.fn(),
  getInstallationOctokit: vi.fn(),
  invalidateInstallationToken: vi.fn(),
}));

import {
  fetchInstallation,
  getInstallationOctokit,
} from "./github-app.service";

const app = createApp();

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
    orgs: { get: vi.fn() },
  };
}

async function login(user: { email: string; password: string }) {
  const res = await request(app).post("/api/auth/login").send({
    email: user.email,
    password: user.password,
  });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

async function setupInstallation(ownerId: string) {
  const installation = await prisma.gitHubInstallation.create({
    data: {
      installationId: "77777",
      accountLogin: "acme-org",
      accountType: "Organization",
      accountId: "999",
      targetType: "Organization",
      userId: ownerId,
    },
  });
  vi.mocked(fetchInstallation).mockResolvedValue({
    id: 77777,
    account: { login: "acme-org", id: 999, type: "Organization" },
    target_type: "Organization",
    permissions: {
      members: "write",
      administration: "write",
      metadata: "read",
    },
  } as never);
  const octokit = makeOctokit();
  vi.mocked(getInstallationOctokit).mockResolvedValue(octokit as never);
  return { installation, octokit };
}

beforeAll(() => {
  setRateLimitsEnabledInTest(false);
});

beforeEach(async () => {
  await resetDatabase();
  vi.resetAllMocks();
});

afterAll(async () => {
  setRateLimitsEnabledInTest(true);
  await prisma.$disconnect();
});

describe("routes équipes GitHub — authentification et RBAC", () => {
  it("refuse les requêtes non authentifiées", async () => {
    const res = await request(app).get("/api/github/organizations");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("autorise un DEVELOPER à lire ses organisations", async () => {
    const user = await createUser({ role: "DEVELOPER" });
    await setupInstallation(user.id);
    const token = await login(user);

    const res = await request(app)
      .get("/api/github/organizations")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.organizations).toHaveLength(1);
    expect(res.body.organizations[0].login).toBe("acme-org");
  });

  it("refuse la création d'équipe à un DEVELOPER sans appeler GitHub", async () => {
    const user = await createUser({ role: "DEVELOPER" });
    const { installation, octokit } = await setupInstallation(user.id);
    const token = await login(user);

    const res = await request(app)
      .post(`/api/github/organizations/${installation.installationId}/teams`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Équipe interdite", privacy: "closed" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(octokit.teams.create).not.toHaveBeenCalled();
  });

  it("crée une équipe pour un ADMIN et retourne le résultat GitHub", async () => {
    const user = await createUser({ role: "ADMIN" });
    const { installation, octokit } = await setupInstallation(user.id);
    octokit.teams.create.mockResolvedValue({
      data: {
        id: 88,
        name: "Équipe créée",
        slug: "equipe-creee",
        description: null,
        privacy: "closed",
        html_url: "https://github.com/orgs/acme-org/teams/equipe-creee",
        members_count: 0,
        repos_count: 0,
        parent: null,
      },
    });
    const token = await login(user);

    const res = await request(app)
      .post(`/api/github/organizations/${installation.installationId}/teams`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Équipe créée", privacy: "closed" });

    expect(res.status).toBe(201);
    expect(res.body.team.githubTeamId).toBe("88");
    expect(octokit.teams.create).toHaveBeenCalledTimes(1);
    expect(await prisma.gitHubTeam.count()).toBe(1);
  });

  it("rejette un payload invalide avant tout appel GitHub", async () => {
    const user = await createUser({ role: "ADMIN" });
    const { installation, octokit } = await setupInstallation(user.id);
    const token = await login(user);

    const res = await request(app)
      .post(`/api/github/organizations/${installation.installationId}/teams`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "   ", privacy: "public" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(octokit.teams.create).not.toHaveBeenCalled();
  });
});
