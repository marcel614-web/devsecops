// apps/api/src/modules/deployments/approvals.service.ts
import {
  DeploymentApprovalStatus,
  DeploymentStatus,
  NotificationKind,
  PipelineStatus,
  Prisma,
  Role,
  StepStatus,
} from "@prisma/client";
import { prisma } from "../../utils/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { resumePipeline } from "../pipelines/pipelines.service";
import type {
  ApprovalDecisionInput,
  ApprovalListQuery,
} from "./approvals.schema";

export interface ActorContext {
  id: string;
  role: Role;
}

function isAuthorized(
  actor: ActorContext,
  project: { ownerId: string },
): boolean {
  return actor.role === Role.ADMIN || project.ownerId === actor.id;
}

export async function listApprovals(
  actor: ActorContext,
  query: ApprovalListQuery,
) {
  const where: Prisma.DeploymentApprovalWhereInput = {};
  if (query.status) where.status = query.status;
  if (actor.role !== Role.ADMIN) {
    where.project = { ownerId: actor.id };
  }

  const skip = (query.page - 1) * query.pageSize;
  const [items, total] = await prisma.$transaction([
    prisma.deploymentApproval.findMany({
      where,
      skip,
      take: query.pageSize,
      orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
      include: {
        project: { select: { id: true, name: true, ownerId: true } },
        pipeline: {
          select: {
            id: true,
            commitSha: true,
            branch: true,
            status: true,
            pullRequestNumber: true,
          },
        },
        decidedBy: { select: { id: true, name: true, email: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.deploymentApproval.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

async function loadApproval(actor: ActorContext, approvalId: string) {
  const approval = await prisma.deploymentApproval.findUnique({
    where: { id: approvalId },
    include: {
      project: { select: { id: true, name: true, ownerId: true } },
      pipeline: {
        select: {
          id: true,
          status: true,
          commitSha: true,
          branch: true,
          createdAt: true,
        },
      },
    },
  });

  if (!approval) throw new NotFoundError("Approbation introuvable");
  if (!isAuthorized(actor, approval.project)) {
    throw new ForbiddenError(
      "Seul le propriétaire du projet ou un administrateur peut décider de cette approbation",
    );
  }
  return approval;
}

/**
 * Décision explicite, horodatée et liée à l'artefact.
 *
 * Aucun chemin ne permet d'approuver un autre commit/digest que celui qui a
 * été proposé : les valeurs sont revérifiées contre le pipeline au moment de
 * la décision.
 */
export async function decideApproval(
  actor: ActorContext,
  approvalId: string,
  input: ApprovalDecisionInput,
) {
  const approval = await loadApproval(actor, approvalId);

  if (approval.status !== DeploymentApprovalStatus.PENDING) {
    throw new ConflictError(
      `Cette approbation est déjà ${approval.status} et ne peut plus être modifiée`,
    );
  }

  if (input.decision === "REJECT" && !input.comment?.trim()) {
    throw new ConflictError("Un motif est requis pour refuser une promotion");
  }

  const now = new Date();
  if (approval.expiresAt && approval.expiresAt <= now) {
    await prisma.deploymentApproval.update({
      where: { id: approval.id },
      data: { status: DeploymentApprovalStatus.EXPIRED },
    });
    throw new ConflictError("Cette demande d'approbation a expiré");
  }

  if (approval.pipeline.status !== PipelineStatus.WAITING_APPROVAL) {
    throw new ConflictError(
      `Le pipeline n'est pas en attente d'approbation (statut : ${approval.pipeline.status})`,
    );
  }

  // Un commit plus récent, encore actif ou déjà déployé sur la même branche,
  // rend cette décision obsolète : l'approuver reviendrait à autoriser
  // l'écrasement d'une version plus récente par un artefact antérieur.
  const newerPipeline = await prisma.pipeline.findFirst({
    where: {
      projectId: approval.projectId,
      branch: approval.pipeline.branch,
      commitSha: { not: approval.commitSha },
      createdAt: { gt: approval.pipeline.createdAt },
      status: {
        in: [
          PipelineStatus.QUEUED,
          PipelineStatus.RUNNING,
          PipelineStatus.WAITING_APPROVAL,
          PipelineStatus.SUCCESS,
          PipelineStatus.SUCCESS_WITH_WARNINGS,
        ],
      },
    },
    select: { id: true, commitSha: true },
  });

  if (newerPipeline) {
    await prisma.deploymentApproval.update({
      where: { id: approval.id },
      data: {
        status: DeploymentApprovalStatus.REVOKED,
        comment: `Commit plus récent ${newerPipeline.commitSha.slice(0, 12)} sur la branche`,
      },
    });
    throw new ConflictError(
      "Un commit plus récent est déjà en cours ou déployé sur cette branche : approbation révoquée",
    );
  }

  const [image, pipeline] = await Promise.all([
    prisma.dockerImage.findUnique({
      where: { pipelineId: approval.pipelineId },
      select: { imageDigest: true },
    }),
    prisma.pipeline.findUnique({
      where: { id: approval.pipelineId },
      select: { commitSha: true },
    }),
  ]);

  if (
    !image?.imageDigest ||
    !pipeline ||
    pipeline.commitSha !== approval.commitSha ||
    image.imageDigest !== approval.imageDigest
  ) {
    await prisma.deploymentApproval.update({
      where: { id: approval.id },
      data: {
        status: DeploymentApprovalStatus.REVOKED,
        comment: "Artefact du pipeline différent de la demande d'approbation",
      },
    });
    throw new ConflictError(
      "L'artefact du pipeline ne correspond plus à la demande : approbation révoquée",
    );
  }

  const approved = input.decision === "APPROVE";
  const status = approved
    ? DeploymentApprovalStatus.APPROVED
    : DeploymentApprovalStatus.REJECTED;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.deploymentApproval.updateMany({
      where: { id: approval.id, status: DeploymentApprovalStatus.PENDING },
      data: {
        status,
        decidedById: actor.id,
        decidedAt: now,
        comment: input.comment?.trim() || null,
      },
    });

    if (updated.count === 0) {
      throw new ConflictError(
        "Cette approbation a déjà été décidée par un autre utilisateur",
      );
    }

    if (!approved) {
      await tx.pipeline.update({
        where: { id: approval.pipelineId },
        data: {
          status: PipelineStatus.FAILED,
          finishedAt: now,
        },
      });
      await tx.pipelineStep.updateMany({
        where: {
          pipelineId: approval.pipelineId,
          type: "APPROVAL",
        },
        data: {
          status: StepStatus.FAILED,
          finishedAt: now,
          error: input.comment?.trim() || "Promotion refusée par l'approbateur",
        },
      });
      await tx.deployment.updateMany({
        where: {
          pipelineId: approval.pipelineId,
          productionStatus: null,
        },
        data: {
          status: DeploymentStatus.FAILED,
          finishedAt: now,
          error: input.comment?.trim() || "Promotion refusée par l'approbateur",
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: approved
          ? "DEPLOYMENT_APPROVAL_APPROVED"
          : "DEPLOYMENT_APPROVAL_REJECTED",
        targetType: "DeploymentApproval",
        targetId: approval.id,
        metadataJson: {
          pipelineId: approval.pipelineId,
          commitSha: approval.commitSha,
          imageTag: approval.imageTag,
          imageDigest: approval.imageDigest,
          comment: input.comment?.trim() || null,
          decidedAt: now.toISOString(),
        },
      },
    });

    if (!approved) {
      await tx.notification.upsert({
        where: {
          userId_sourceKey: {
            userId: approval.project.ownerId,
            sourceKey: `deployment-approval:${approval.pipelineId}`,
          },
        },
        create: {
          userId: approval.project.ownerId,
          sourceKey: `deployment-approval:${approval.pipelineId}`,
          kind: NotificationKind.DANGER,
          title: `Promotion refusée sur ${approval.project.name}`,
          message:
            `La promotion du commit ${approval.commitSha.slice(0, 12)} a été refusée.` +
            (input.comment ? ` Motif : ${input.comment.trim()}` : ""),
          link: `/deployments?pipelineId=${approval.pipelineId}`,
        },
        update: {
          kind: NotificationKind.DANGER,
          title: `Promotion refusée sur ${approval.project.name}`,
          message:
            `La promotion du commit ${approval.commitSha.slice(0, 12)} a été refusée.` +
            (input.comment ? ` Motif : ${input.comment.trim()}` : ""),
          link: `/deployments?pipelineId=${approval.pipelineId}`,
          readAt: null,
          deletedAt: null,
        },
      });
    }

    return tx.deploymentApproval.findUniqueOrThrow({
      where: { id: approval.id },
      include: {
        decidedBy: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
    });
  });

  if (approved) {
    // Reprise de la même exécution : l'étape APPROVAL relira la décision,
    // puis PROMOTE déploiera exactement le digest approuvé.
    await resumePipeline(actor, approval.projectId, approval.pipelineId);
  }

  return result;
}
