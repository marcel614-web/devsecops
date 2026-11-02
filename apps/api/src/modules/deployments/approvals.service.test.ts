// apps/api/src/modules/deployments/approvals.service.test.ts
import {
  DeploymentApprovalStatus,
  PipelineStatus,
  Role,
  StepStatus,
} from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../utils/prisma";
import {
  ConflictError,
  ForbiddenError,
} from "../../utils/errors";
import {
  createProject,
  createUser,
  resetDatabase,
} from "../../test/helpers";

// La reprise réelle enfile un job BullMQ : on la mocke pour que le test
// porte uniquement sur la décision et ses invariants.
vi.mock("../pipelines/pipelines.service", () => ({
  resumePipeline: vi.fn(async () => undefined),
}));

import { resumePipeline } from "../pipelines/pipelines.service";
import { decideApproval } from "./approvals.service";

const COMMIT_SHA = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;

async function seed(options: {
  pipelineStatus?: PipelineStatus;
  imageDigest?: string;
  approvalDigest?: string;
  expiresAt?: Date | null;
  approvalStatus?: DeploymentApprovalStatus;
} = {}) {
  const owner = await createUser({ email: "owner@test.local" });
  const other = await createUser({ email: "other@test.local" });
  const admin = await createUser({
    email: "admin@test.local",
    role: Role.ADMIN,
  });
  const project = await createProject(owner.id);

  const pipeline = await prisma.pipeline.create({
    data: {
      projectId: project.id,
      commitSha: COMMIT_SHA,
      branch: "main",
      author: "Alice",
      trigger: "push",
      status: options.pipelineStatus ?? PipelineStatus.WAITING_APPROVAL,
    },
  });

  await prisma.dockerImage.create({
    data: {
      pipelineId: pipeline.id,
      imageTag: `devsecops/${project.id}:${COMMIT_SHA.slice(0, 12)}`,
      imageDigest: options.imageDigest ?? DIGEST,
      digestVerifiedAt: new Date(),
    },
  });

  await prisma.pipelineStep.create({
    data: {
      pipelineId: pipeline.id,
      name: "Approbation production",
      type: "APPROVAL",
      order: 12,
      status: StepStatus.WAITING_APPROVAL,
    },
  });

  const approval = await prisma.deploymentApproval.create({
    data: {
      pipelineId: pipeline.id,
      projectId: project.id,
      environment: "PRODUCTION",
      commitSha: COMMIT_SHA,
      imageTag: `devsecops/${project.id}:${COMMIT_SHA.slice(0, 12)}`,
      imageDigest: options.approvalDigest ?? DIGEST,
      status: options.approvalStatus ?? DeploymentApprovalStatus.PENDING,
      expiresAt:
        options.expiresAt === undefined
          ? new Date(Date.now() + 24 * 60 * 60 * 1000)
          : options.expiresAt,
    },
  });

  return { owner, other, admin, project, pipeline, approval };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("décision d'approbation de production", () => {
  it("refuse un utilisateur qui n'est ni propriétaire ni administrateur", async () => {
    const { other, approval } = await seed();

    await expect(
      decideApproval(other, approval.id, { decision: "APPROVE" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const stored = await prisma.deploymentApproval.findUniqueOrThrow({
      where: { id: approval.id },
    });
    expect(stored.status).toBe(DeploymentApprovalStatus.PENDING);
    expect(resumePipeline).not.toHaveBeenCalled();
  });

  it("approuve une seule fois, avec horodatage et lien vers le commit/digest", async () => {
    const { owner, approval, pipeline } = await seed();

    const decided = await decideApproval(owner, approval.id, {
      decision: "APPROVE",
      comment: "Revue sécurité OK",
    });

    expect(decided.status).toBe(DeploymentApprovalStatus.APPROVED);
    expect(decided.decidedById).toBe(owner.id);
    expect(decided.decidedAt).not.toBeNull();
    expect(decided.commitSha).toBe(COMMIT_SHA);
    expect(decided.imageDigest).toBe(DIGEST);
    expect(resumePipeline).toHaveBeenCalledTimes(1);
    expect(resumePipeline).toHaveBeenCalledWith(
      owner,
      decided.projectId,
      pipeline.id,
    );

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "DEPLOYMENT_APPROVAL_APPROVED" },
    });
    expect(audit.userId).toBe(owner.id);
  });

  it("interdit à un administrateur de réutiliser l'approbation pour un autre digest", async () => {
    const { admin, approval } = await seed({
      approvalDigest: `sha256:${"c".repeat(64)}`,
    });

    await expect(
      decideApproval(admin, approval.id, { decision: "APPROVE" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const stored = await prisma.deploymentApproval.findUniqueOrThrow({
      where: { id: approval.id },
    });
    expect(stored.status).toBe(DeploymentApprovalStatus.REVOKED);
    expect(resumePipeline).not.toHaveBeenCalled();
  });

  it("refuse une approbation expirée et la marque EXPIRED", async () => {
    const { owner, approval } = await seed({
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      decideApproval(owner, approval.id, { decision: "APPROVE" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const stored = await prisma.deploymentApproval.findUniqueOrThrow({
      where: { id: approval.id },
    });
    expect(stored.status).toBe(DeploymentApprovalStatus.EXPIRED);
  });

  it("exige un motif pour refuser puis arrête le pipeline", async () => {
    const { owner, approval, pipeline } = await seed();

    await expect(
      decideApproval(owner, approval.id, { decision: "REJECT" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const rejected = await decideApproval(owner, approval.id, {
      decision: "REJECT",
      comment: "Vulnérabilité critique non corrigée",
    });
    expect(rejected.status).toBe(DeploymentApprovalStatus.REJECTED);
    expect(resumePipeline).not.toHaveBeenCalled();

    const storedPipeline = await prisma.pipeline.findUniqueOrThrow({
      where: { id: pipeline.id },
    });
    expect(storedPipeline.status).toBe(PipelineStatus.FAILED);
    const step = await prisma.pipelineStep.findFirstOrThrow({
      where: { pipelineId: pipeline.id, type: "APPROVAL" },
    });
    expect(step.status).toBe(StepStatus.FAILED);
    expect(step.error).toContain("Vulnérabilité critique");
  });

  it("révoque l'approbation si un commit plus récent est déjà déployé", async () => {
    const { owner, approval, project, pipeline } = await seed();

    await prisma.pipeline.create({
      data: {
        projectId: project.id,
        commitSha: "c".repeat(40),
        branch: "main",
        author: "Bob",
        trigger: "push",
        status: PipelineStatus.SUCCESS,
        createdAt: new Date(pipeline.createdAt.getTime() + 60_000),
      },
    });

    await expect(
      decideApproval(owner, approval.id, { decision: "APPROVE" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const stored = await prisma.deploymentApproval.findUniqueOrThrow({
      where: { id: approval.id },
    });
    expect(stored.status).toBe(DeploymentApprovalStatus.REVOKED);
    expect(stored.comment).toMatch(/plus récent/);
    expect(resumePipeline).not.toHaveBeenCalled();
  });

  it("refuse une seconde décision sur une demande déjà traitée", async () => {
    const { owner, approval } = await seed({
      approvalStatus: DeploymentApprovalStatus.APPROVED,
    });

    await expect(
      decideApproval(owner, approval.id, { decision: "REJECT", comment: "trop tard" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse d'approuver si le pipeline n'est plus en attente", async () => {
    const { owner, approval } = await seed({
      pipelineStatus: PipelineStatus.RUNNING,
    });

    await expect(
      decideApproval(owner, approval.id, { decision: "APPROVE" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(resumePipeline).not.toHaveBeenCalled();
  });
});
