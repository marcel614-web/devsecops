// apps/api/src/modules/github/project-teams.service.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../../utils/prisma";
import {
  resetDatabase,
  createUser,
  createProject,
} from "../../test/helpers";
import {
  associateTeamToProject,
  listProjectTeams,
  listTeamProjects,
  removeProjectTeam,
  updateProjectTeamRole,
} from "./project-teams.service";
import { AppError } from "../../utils/errors";

vi.mock("./github-app.service", () => ({
  fetchInstallation: vi.fn(),
  getInstallationOctokit: vi.fn(),
  invalidateInstallationToken: vi.fn(),
}));

async function setupTeam(ownerId: string, overrides: { revoked?: boolean } = {}) {
  const installation = await prisma.gitHubInstallation.create({
    data: {
      installationId: `inst-${Math.random().toString(36).slice(2)}`,
      accountLogin: "acme-org",
      accountType: "Organization",
      accountId: "999",
      targetType: "Organization",
      userId: ownerId,
      revokedAt: overrides.revoked ? new Date() : null,
    },
  });
  return prisma.gitHubTeam.create({
    data: {
      installationId: installation.id,
      githubTeamId: "42",
      orgLogin: "acme-org",
      slug: "security",
      name: "Security",
      privacy: "closed",
      htmlUrl: "https://github.com/orgs/acme-org/teams/security",
    },
  });
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
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("project-teams.service", () => {
  it("associe une équipe à un projet avec un rôle interne", async () => {
    const owner = await createUser({ role: "DEVELOPER" });
    const project = await createProject(owner.id);
    const team = await setupTeam(owner.id);

    const link = await associateTeamToProject(
      owner,
      project.id,
      team.id,
      "DEVELOPER",
    );

    expect(link.role).toBe("DEVELOPER");
    expect(link.team.slug).toBe("security");
    const audit = await prisma.auditLog.findFirst({
      where: { action: "PROJECT_TEAM_ASSOCIATED" },
    });
    expect(audit).not.toBeNull();
  });

  it("est idempotent et met à jour le rôle sans créer de doublon", async () => {
    const owner = await createUser({ role: "DEVELOPER" });
    const project = await createProject(owner.id);
    const team = await setupTeam(owner.id);

    const first = await associateTeamToProject(
      owner,
      project.id,
      team.id,
      "VIEWER",
    );
    const second = await associateTeamToProject(
      owner,
      project.id,
      team.id,
      "MAINTAINER",
    );

    expect(second.id).toBe(first.id);
    expect(second.role).toBe("MAINTAINER");
    expect(await prisma.projectTeam.count()).toBe(1);
  });

  it("refuse un utilisateur non propriétaire du projet", async () => {
    const owner = await createUser({
      role: "DEVELOPER",
      email: "owner@test.local",
    });
    const other = await createUser({
      role: "DEVELOPER",
      email: "other@test.local",
    });
    const project = await createProject(owner.id);
    const team = await setupTeam(other.id);

    await expectAppError(
      associateTeamToProject(other, project.id, team.id, "VIEWER"),
      403,
      "FORBIDDEN",
    );
  });

  it("refuse une équipe issue d'une installation d'un autre utilisateur", async () => {
    const owner = await createUser({
      role: "DEVELOPER",
      email: "owner@test.local",
    });
    const other = await createUser({
      role: "DEVELOPER",
      email: "other@test.local",
    });
    const project = await createProject(owner.id);
    const team = await setupTeam(other.id);

    await expectAppError(
      associateTeamToProject(owner, project.id, team.id, "VIEWER"),
      403,
      "FORBIDDEN",
    );
  });

  it("permet à un ADMIN de gérer un projet dont il n'est pas propriétaire", async () => {
    const owner = await createUser({
      role: "DEVELOPER",
      email: "owner@test.local",
    });
    const admin = await createUser({
      role: "ADMIN",
      email: "admin@test.local",
    });
    const project = await createProject(owner.id);
    const team = await setupTeam(admin.id);

    const link = await associateTeamToProject(
      admin,
      project.id,
      team.id,
      "SECURITY_ANALYST",
    );
    expect(link.role).toBe("SECURITY_ANALYST");
  });

  it("met à jour puis supprime une association", async () => {
    const owner = await createUser({ role: "DEVELOPER" });
    const project = await createProject(owner.id);
    const team = await setupTeam(owner.id);
    const link = await associateTeamToProject(
      owner,
      project.id,
      team.id,
      "VIEWER",
    );

    const updated = await updateProjectTeamRole(owner, link.id, "OWNER");
    expect(updated.role).toBe("OWNER");

    const removed = await removeProjectTeam(owner, link.id);
    expect(removed.removed).toBe(true);
    expect(await prisma.projectTeam.count()).toBe(0);
  });

  it("liste les projets associés à une équipe", async () => {
    const owner = await createUser({ role: "DEVELOPER" });
    const project = await createProject(owner.id);
    const team = await setupTeam(owner.id);
    await associateTeamToProject(owner, project.id, team.id, "DEVELOPER");

    const installation = await prisma.gitHubInstallation.findFirst({
      where: { id: team.installationId },
    });
    const result = await listTeamProjects(
      owner,
      installation!.installationId,
      "security",
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].project.id).toBe(project.id);
  });

  it("refuse une équipe marquée DELETED après suppression sur GitHub", async () => {
    const owner = await createUser({ role: "DEVELOPER" });
    const project = await createProject(owner.id);
    const team = await setupTeam(owner.id);
    await prisma.gitHubTeam.update({
      where: { id: team.id },
      data: { syncState: "DELETED" },
    });

    await expectAppError(
      associateTeamToProject(owner, project.id, team.id, "VIEWER"),
      404,
      "NOT_FOUND",
    );
  });

  it("refuse une installation révoquée", async () => {
    const owner = await createUser({ role: "DEVELOPER" });
    const project = await createProject(owner.id);
    const team = await setupTeam(owner.id, { revoked: true });

    await expectAppError(
      associateTeamToProject(owner, project.id, team.id, "VIEWER"),
      404,
      "NOT_FOUND",
    );
  });

  it("liste les équipes associées à un projet", async () => {
    const owner = await createUser({ role: "DEVELOPER" });
    const project = await createProject(owner.id);
    const team = await setupTeam(owner.id);
    await associateTeamToProject(owner, project.id, team.id, "VIEWER");

    const result = await listProjectTeams(owner, project.id);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].team.id).toBe(team.id);
  });
});
