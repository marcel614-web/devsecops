import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { NotFoundError, ForbiddenError } from "../../utils/errors";

export interface ActorContext {
  id: string;
  role: Role;
}

export async function listReports(
  actor: ActorContext,
  query: { page: number; pageSize: number; projectId?: string },
) {
  const where: Prisma.SecurityReportWhereInput = {};

  if (actor.role !== Role.ADMIN) {
    where.project = { ownerId: actor.id };
  }
  if (query.projectId) {
    where.projectId = query.projectId;
  }

  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.securityReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
      include: {
        project: { select: { id: true, name: true } },
        pipeline: { select: { id: true, commitSha: true, status: true, branch: true } },
      },
    }),
    prisma.securityReport.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export async function getReport(actor: ActorContext, id: string) {
  const report = await prisma.securityReport.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true, ownerId: true } },
      pipeline: { select: { id: true, commitSha: true, status: true, branch: true } },
    },
  });
  if (!report) throw new NotFoundError("Rapport introuvable");

  if (actor.role !== Role.ADMIN && report.project.ownerId !== actor.id) {
    throw new ForbiddenError("Accès interdit à ce rapport");
  }

  return report;
}