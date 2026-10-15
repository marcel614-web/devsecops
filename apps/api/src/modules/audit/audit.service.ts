import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { ForbiddenError } from "../../utils/errors";

export interface ActorContext {
  id: string;
  role: Role;
}

export async function listAuditLogs(
  actor: ActorContext,
  query: {
    page: number;
    pageSize: number;
    action?: string;
    targetType?: string;
    userId?: string;
    search?: string;
  },
) {
  if (actor.role !== Role.ADMIN) {
    throw new ForbiddenError("Seul un administrateur peut consulter le journal d'audit");
  }

  const where: Prisma.AuditLogWhereInput = {};
  if (query.action) where.action = query.action;
  if (query.targetType) where.targetType = query.targetType;
  if (query.userId) where.userId = query.userId;
  if (query.search) {
    where.OR = [
      { action: { contains: query.search, mode: "insensitive" } },
      { targetType: { contains: query.search, mode: "insensitive" } },
      { targetId: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}