// apps/api/src/modules/verifications/verifications.service.ts
import { Role } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { ForbiddenError, NotFoundError } from "../../utils/errors";
import type { VerificationListQuery } from "./verifications.schema";

export interface ActorContext {
  id: string;
  role: Role;
}

async function ensureProjectAccess(actor: ActorContext, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true },
  });
  if (!project) throw new NotFoundError("Projet introuvable");
  if (actor.role === Role.ADMIN) return project;
  if (project.ownerId !== actor.id) {
    throw new ForbiddenError("Accès interdit à ce projet");
  }
  return project;
}

export async function listVerifications(
  actor: ActorContext,
  projectId: string,
  query: VerificationListQuery,
) {
  await ensureProjectAccess(actor, projectId);
  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.deploymentVerification.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
      select: {
        id: true,
        deploymentId: true,
        pipelineId: true,
        environment: true,
        status: true,
        imageTag: true,
        imageDigest: true,
        checksJson: true,
        summaryJson: true,
        error: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        createdAt: true,
        deployment: {
          select: {
            id: true,
            environment: true,
            status: true,
            stagingStatus: true,
          },
        },
        pipeline: {
          select: {
            id: true,
            commitSha: true,
            branch: true,
            status: true,
          },
        },
      },
    }),
    prisma.deploymentVerification.count({ where: { projectId } }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}
