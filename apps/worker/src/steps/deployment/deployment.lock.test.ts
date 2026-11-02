// apps/worker/src/steps/deployment/deployment.lock.test.ts
import { PipelineStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("../../utils/prisma", () => ({
  prisma: {
    deploymentLock: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    pipeline: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "../../utils/prisma";
import {
  acquireDeploymentLock,
  assertPipelineIsCurrent,
  releaseDeploymentLock,
} from "./deployment.lock";

const db = prisma as unknown as {
  deploymentLock: {
    deleteMany: Mock;
    create: Mock;
    findUnique: Mock;
  };
  pipeline: {
    findUnique: Mock;
    findFirst: Mock;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.deploymentLock.deleteMany.mockResolvedValue({ count: 0 });
});

describe("verrou de déploiement", () => {
  it("autorise un seul déploiement à la fois", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    db.deploymentLock.create.mockResolvedValue({
      projectId: "p1",
      pipelineId: "run-1",
      environment: "PRODUCTION",
      expiresAt,
    });

    const lock = await acquireDeploymentLock("p1", "run-1", "PRODUCTION");
    expect(lock.pipelineId).toBe("run-1");
    expect(db.deploymentLock.create).toHaveBeenCalledTimes(1);
  });

  it("refuse le second déploiement concurrent avec le détenteur du verrou", async () => {
    db.deploymentLock.create.mockRejectedValue({ code: "P2002" });
    db.deploymentLock.findUnique.mockResolvedValue({
      pipelineId: "run-1",
      environment: "PRODUCTION",
      acquiredAt: new Date("2026-01-01T10:00:00Z"),
    });

    await expect(
      acquireDeploymentLock("p1", "run-2", "PRODUCTION"),
    ).rejects.toThrow(/Déploiement concurrent refusé/);
    await expect(
      acquireDeploymentLock("p1", "run-2", "PRODUCTION"),
    ).rejects.toThrow(/run-1/);
  });

  it("propage les autres erreurs de base", async () => {
    db.deploymentLock.create.mockRejectedValue(new Error("connexion perdue"));

    await expect(
      acquireDeploymentLock("p1", "run-1", "STAGING"),
    ).rejects.toThrow(/connexion perdue/);
  });

  it("ne libère que le verrou de son propre pipeline", async () => {
    await releaseDeploymentLock("p1", "run-1");

    expect(db.deploymentLock.deleteMany).toHaveBeenCalledWith({
      where: { projectId: "p1", pipelineId: "run-1" },
    });
  });
});

describe("pipeline obsolète (nouveau commit)", () => {
  const current = {
    id: "run-1",
    projectId: "p1",
    branch: "main",
    commitSha: "a".repeat(40),
    createdAt: new Date("2026-01-01T10:00:00Z"),
  };

  it("autorise le pipeline courant quand aucun commit plus récent n'est actif", async () => {
    db.pipeline.findUnique.mockResolvedValue(current);
    db.pipeline.findFirst.mockResolvedValue(null);

    await expect(assertPipelineIsCurrent("run-1")).resolves.toBeUndefined();
    expect(db.pipeline.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "p1",
          branch: "main",
          commitSha: { not: current.commitSha },
          status: {
            in: [
              PipelineStatus.QUEUED,
              PipelineStatus.RUNNING,
              PipelineStatus.WAITING_APPROVAL,
              PipelineStatus.SUCCESS,
              PipelineStatus.SUCCESS_WITH_WARNINGS,
            ],
          },
        }),
      }),
    );
  });

  it("refuse le déploiement d'un ancien pipeline si un commit plus récent est actif", async () => {
    db.pipeline.findUnique.mockResolvedValue(current);
    db.pipeline.findFirst.mockResolvedValue({
      id: "run-2",
      commitSha: "b".repeat(40),
      createdAt: new Date("2026-01-01T11:00:00Z"),
    });

    await expect(assertPipelineIsCurrent("run-1")).rejects.toThrow(
      /Pipeline obsolète/,
    );
  });

  it("refuse un pipeline introuvable", async () => {
    db.pipeline.findUnique.mockResolvedValue(null);

    await expect(assertPipelineIsCurrent("missing")).rejects.toThrow(
      /Pipeline introuvable/,
    );
  });
});
