// apps/api/src/modules/vulnerabilities/vulnerabilities.service.ts
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { ForbiddenError, NotFoundError } from "../../utils/errors";
import type { VulnerabilityListQuery } from "./vulnerabilities.schema";

export interface ActorContext {
  id: string;
  role: Role;
}

async function ensureProjectAccess(
  actor: ActorContext,
  projectId: string,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true },
  });
  if (!project) throw new NotFoundError("Projet introuvable");
  if (actor.role === Role.ADMIN) return;
  if (project.ownerId !== actor.id) {
    throw new ForbiddenError("Accès interdit à ce projet");
  }
}

export async function listVulnerabilities(
  actor: ActorContext,
  projectId: string,
  query: VulnerabilityListQuery,
) {
  await ensureProjectAccess(actor, projectId);

  const where: Prisma.VulnerabilityWhereInput = {
    scan: { projectId },
  };
  if (query.severity) where.severity = query.severity;
  if (query.tool) where.tool = query.tool;
  if (query.pipelineId) {
    where.scan = { projectId, pipelineId: query.pipelineId };
  }
  if (query.search) {
    where.OR = [
      { packageName: { contains: query.search, mode: "insensitive" } },
      { filePath: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
      { reference: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.vulnerability.findMany({
      where,
      orderBy: [{ severity: "asc" }, { detectedAt: "desc" }],
      skip,
      take: query.pageSize,
      select: {
        id: true,
        tool: true,
        technology: true,
        severity: true,
        packageName: true,
        filePath: true,
        version: true,
        fixedVersion: true,
        description: true,
        reference: true,
        detectedAt: true,
        scan: {
          select: {
            id: true,
            scanner: true,
            type: true,
            pipelineId: true,
          },
        },
      },
    }),
    prisma.vulnerability.count({ where }),
  ]);

  const grouped = await prisma.vulnerability.groupBy({
    by: ["severity"],
    where: { scan: { projectId } },
    _count: { _all: true },
  });

  const severityCounts = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };
  for (const g of grouped) {
    severityCounts[g.severity] = g._count._all;
  }

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
    severityCounts,
  };
}