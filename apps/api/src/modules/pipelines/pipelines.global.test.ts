// apps/api/src/modules/pipelines/pipelines.global.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../../utils/prisma";
import { resetDatabase, createUser, createProject } from "../../test/helpers";
import { listAllPipelines } from "./pipelines.service";
import { AppError } from "../../utils/errors";

async function createPipeline(
  projectId: string,
  overrides: Partial<{
    commitSha: string;
    branch: string;
    author: string;
    status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";
  }> = {},
) {
  return prisma.pipeline.create({
    data: {
      projectId,
      commitSha: overrides.commitSha ?? "a".repeat(40),
      branch: overrides.branch ?? "main",
      author: overrides.author ?? "Utilisateur Test",
      status: overrides.status ?? "SUCCESS",
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("listAllPipelines", () => {
  it("retourne tous les pipelines des projets de l'utilisateur par défaut", async () => {
    const owner = await createUser({ role: "DEVELOPER" });
    const other = await createUser({
      role: "DEVELOPER",
      email: "other@test.local",
    });
    const projectA = await createProject(owner.id, {
      name: "Projet A",
      repoFullName: "acme/a",
    });
    const projectB = await createProject(owner.id, {
      name: "Projet B",
      repoFullName: "acme/b",
    });
    const otherProject = await createProject(other.id, {
      name: "Projet autre",
      repoFullName: "acme/other",
    });

    await createPipeline(projectA.id, { commitSha: "1".repeat(40) });
    await createPipeline(projectB.id, { commitSha: "2".repeat(40) });
    await createPipeline(projectB.id, { commitSha: "3".repeat(40) });
    await createPipeline(otherProject.id, { commitSha: "4".repeat(40) });

    const result = await listAllPipelines(owner, { page: 1, pageSize: 50 });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(result.items.every((item) => item.projectId !== otherProject.id)).toBe(
      true,
    );
    expect(result.items[0].project).toMatchObject({ name: "Projet B" });
  });

  it("permet à un ADMIN de voir tous les pipelines", async () => {
    const owner = await createUser({ role: "DEVELOPER" });
    const other = await createUser({
      role: "DEVELOPER",
      email: "other@test.local",
    });
    const admin = await createUser({ role: "ADMIN", email: "admin@test.local" });
    const projectA = await createProject(owner.id, {
      repoFullName: "acme/a",
    });
    const projectB = await createProject(other.id, {
      repoFullName: "acme/b",
    });
    await createPipeline(projectA.id, { commitSha: "1".repeat(40) });
    await createPipeline(projectB.id, { commitSha: "2".repeat(40) });

    const result = await listAllPipelines(admin, { page: 1, pageSize: 50 });

    expect(result.total).toBe(2);
  });

  it("filtre par projet quand projectId est fourni", async () => {
    const owner = await createUser({ role: "DEVELOPER" });
    const projectA = await createProject(owner.id, {
      name: "Projet A",
      repoFullName: "acme/a",
    });
    const projectB = await createProject(owner.id, {
      name: "Projet B",
      repoFullName: "acme/b",
    });
    await createPipeline(projectA.id, { commitSha: "1".repeat(40) });
    await createPipeline(projectB.id, { commitSha: "2".repeat(40) });

    const result = await listAllPipelines(owner, {
      page: 1,
      pageSize: 50,
      projectId: projectA.id,
    });

    expect(result.total).toBe(1);
    expect(result.items[0].projectId).toBe(projectA.id);
    expect(result.items[0].project?.name).toBe("Projet A");
  });

  it("refuse le filtre sur un projet d'un autre utilisateur", async () => {
    const owner = await createUser({ role: "DEVELOPER" });
    const other = await createUser({
      role: "DEVELOPER",
      email: "other@test.local",
    });
    const otherProject = await createProject(other.id, {
      repoFullName: "acme/other",
    });

    await expect(
      listAllPipelines(owner, {
        page: 1,
        pageSize: 50,
        projectId: otherProject.id,
      }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      listAllPipelines(owner, {
        page: 1,
        pageSize: 50,
        projectId: otherProject.id,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });
});
