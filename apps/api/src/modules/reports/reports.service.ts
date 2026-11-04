import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { NotFoundError } from "../../utils/errors";
import { requirePermission } from "../authorization/permission.service";
import { PERMISSIONS } from "../authorization/permissions.constants";
import { projectAccessWhere } from "../authorization/project-membership.service";

export interface ActorContext {
  id: string;
  role: Role;
}

export async function listReports(
  actor: ActorContext,
  query: { page: number; pageSize: number; projectId?: string },
) {
  const where: Prisma.SecurityReportWhereInput = {
    project: projectAccessWhere(actor),
  };

  if (query.projectId) {
    await requirePermission(actor, PERMISSIONS.SECURITY_REPORT_READ, {
      projectId: query.projectId,
    });
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
        project: { select: { id: true, name: true, repoFullName: true } },
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
      project: { select: { id: true, name: true, repoFullName: true, ownerId: true } },
      pipeline: { select: { id: true, commitSha: true, status: true, branch: true } },
    },
  });
  if (!report) throw new NotFoundError("Rapport introuvable");

  await requirePermission(actor, PERMISSIONS.SECURITY_REPORT_READ, {
    projectId: report.projectId,
    targetType: "SecurityReport",
    targetId: id,
  });

  return report;
}