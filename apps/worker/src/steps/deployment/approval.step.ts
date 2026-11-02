// apps/worker/src/steps/deployment/approval.step.ts
import { DeploymentApprovalStatus } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

const APPROVAL_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.DEPLOYMENT_APPROVAL_TTL_MS ?? "", 10) ||
    7 * 24 * 60 * 60_000,
);

/**
 * Porte d'approbation humaine avant la promotion staging → production.
 *
 * La décision est liée au pipeline, au SHA complet, au tag et au digest de
 * l'image. Une approbation ne peut donc jamais être réutilisée pour un autre
 * commit ou un autre artefact.
 */
export async function approvalStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { config: true },
  });

  if (!project) {
    return { success: false, exitCode: 1, error: "Projet introuvable" };
  }

  const required =
    project.config?.deploymentStrategy === "staging_then_production" &&
    project.config.requireProductionApproval === true;

  if (!required) {
    await ctx.log("info", "Approbation de production non requise — étape ignorée");
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "approval not required" },
    };
  }

  const image = await prisma.dockerImage.findUnique({
    where: { pipelineId: ctx.pipelineId },
    select: { imageTag: true, imageDigest: true },
  });
  if (!image?.imageDigest) {
    return {
      success: false,
      exitCode: 1,
      error:
        "Digest de l'image introuvable : approbation et promotion impossibles",
    };
  }
  // Capture explicite : TypeScript perd le narrowing dans la transaction.
  const imageDigest = image.imageDigest;

  const deployment = await prisma.deployment.findUnique({
    where: { pipelineId: ctx.pipelineId },
    select: { id: true },
  });

  const existing = await prisma.deploymentApproval.findUnique({
    where: { pipelineId: ctx.pipelineId },
  });

  const now = new Date();
  const decidedForThisArtifact =
    existing?.status === DeploymentApprovalStatus.APPROVED &&
    existing.commitSha === ctx.commitSha &&
    existing.imageDigest === image.imageDigest &&
    (!existing.expiresAt || existing.expiresAt > now);

  if (decidedForThisArtifact) {
    await ctx.log(
      "info",
      `Approbation valide pour ${ctx.commitSha.slice(0, 12)} / ${image.imageDigest}` +
        `${existing.decidedAt ? ` (décidée le ${existing.decidedAt.toISOString()})` : ""}`,
    );
    return {
      success: true,
      exitCode: 0,
      data: {
        approvalId: existing.id,
        status: existing.status,
        approvedById: existing.decidedById,
        decidedAt: existing.decidedAt?.toISOString() ?? null,
      },
    };
  }

  if (existing?.status === DeploymentApprovalStatus.REJECTED) {
    return {
      success: false,
      exitCode: 1,
      error: "Promotion refusée par l'approbateur",
      data: { approvalId: existing.id, status: existing.status },
    };
  }

  if (
    existing &&
    existing.status !== DeploymentApprovalStatus.PENDING &&
    // Une demande expirée ou révoquée peut être reformulée : elle ne
    // constitue pas une décision sur l'artefact courant.
    existing.status !== DeploymentApprovalStatus.EXPIRED &&
    existing.status !== DeploymentApprovalStatus.REVOKED &&
    !(
      existing.status === DeploymentApprovalStatus.APPROVED &&
      existing.commitSha === ctx.commitSha &&
      existing.imageDigest === image.imageDigest
    )
  ) {
    return {
      success: false,
      exitCode: 1,
      error:
        "Approbation existante invalide pour cet artefact (commit ou digest différent)",
      data: { approvalId: existing.id, status: existing.status },
    };
  }

  if (existing?.status === DeploymentApprovalStatus.PENDING) {
    await ctx.log(
      "warn",
      `En attente d'approbation pour ${ctx.commitSha.slice(0, 12)} / ${image.imageDigest}`,
    );
    return {
      success: false,
      exitCode: 0,
      waitingApproval: true,
      error: "Approbation de production requise",
      data: { approvalId: existing.id, status: existing.status },
    };
  }

  const approval = await prisma.$transaction(async (tx) => {
    const created = await tx.deploymentApproval.upsert({
      where: { pipelineId: ctx.pipelineId },
      create: {
        pipelineId: ctx.pipelineId,
        projectId: ctx.projectId,
        deploymentId: deployment?.id ?? null,
        environment: "PRODUCTION",
        commitSha: ctx.commitSha,
        imageTag: image.imageTag,
        imageDigest,
        status: DeploymentApprovalStatus.PENDING,
        requestedAt: now,
        expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
      },
      update: {
        // Un nouvel artefact ne réutilise jamais une ancienne décision.
        deploymentId: deployment?.id ?? null,
        commitSha: ctx.commitSha,
        imageTag: image.imageTag,
        imageDigest,
        status: DeploymentApprovalStatus.PENDING,
        requestedAt: now,
        expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
        decidedById: null,
        decidedAt: null,
        comment: null,
      },
      select: { id: true, expiresAt: true },
    });

    await tx.notification.upsert({
      where: {
        userId_sourceKey: {
          userId: project.ownerId,
          sourceKey: `deployment-approval:${ctx.pipelineId}`,
        },
      },
      create: {
        userId: project.ownerId,
        sourceKey: `deployment-approval:${ctx.pipelineId}`,
        kind: "WARNING",
        title: `Approbation requise sur ${project.name}`,
        message:
          `Le pipeline ${ctx.commitSha.slice(0, 12)} est en staging. ` +
          `Approuvez explicitement la promotion de l'image ${imageDigest.slice(0, 19)}…`,
        link: `/deployments?pipelineId=${ctx.pipelineId}`,
      },
      update: {
        title: `Approbation requise sur ${project.name}`,
        message:
          `Le pipeline ${ctx.commitSha.slice(0, 12)} est en staging. ` +
          `Approuvez explicitement la promotion de l'image ${imageDigest.slice(0, 19)}…`,
        link: `/deployments?pipelineId=${ctx.pipelineId}`,
        readAt: null,
        deletedAt: null,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: project.ownerId,
        action: "DEPLOYMENT_APPROVAL_REQUESTED",
        targetType: "Pipeline",
        targetId: ctx.pipelineId,
        metadataJson: {
          approvalId: created.id,
          commitSha: ctx.commitSha,
          imageTag: image.imageTag,
          imageDigest,
          expiresAt: created.expiresAt?.toISOString() ?? null,
        },
      },
    });

    return created;
  });

  await ctx.log(
    "warn",
    `Approbation demandée (${approval.id}) — pipeline en attente, staging conservé`,
  );

  return {
    success: false,
    exitCode: 0,
    waitingApproval: true,
    error: "Approbation de production requise",
    data: { approvalId: approval.id, status: "PENDING" },
  };
}
