import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../utils/prisma";

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
    category?: string;
    targetType?: string;
    userId?: string;
    search?: string;
    from?: string;
    to?: string;
  },
) {
  const where: Prisma.AuditLogWhereInput = {};

  // Un non-admin ne voit que son propre historique.
  if (actor.role !== Role.ADMIN) {
    where.userId = actor.id;
  } else if (query.userId) {
    where.userId = query.userId;
  }

  const andConditions: Prisma.AuditLogWhereInput[] = [];

  // Clés "canoniques" envoyées par le front (cf. AuditPage.tsx).
  const CATEGORY_KEYWORDS: Record<string, string[]> = {
    creation: ["CREATE", "REGISTER", "INSTALL", "ASSOCIATED", "ADD"],
    modification: ["UPDATE", "MODIFY", "PATCH", "SYNC", "EDIT", "CONFIG"],
    suppression: ["DELETE", "REMOVE", "REVOKE", "PURGE", "DETACH"],
    auth: ["LOGIN", "LOGOUT", "SIGNIN", "SIGNOUT", "AUTH", "PASSWORD", "PROFILE", "REGISTER"],
    pipeline: ["PIPELINE", "TRIGGER", "RUN", "CANCEL"],
    infra: ["SERVER", "DEPLOY"],
    security: ["SECURITY", "SCAN", "VULN"],
  };

  // Alias pour tolérer d'anciennes valeurs/URLs (CREATE, UPDATE, DELETE...).
  const CATEGORY_ALIASES: Record<string, string> = {
    create: "creation",
    add: "creation",
    register: "creation",
    update: "modification",
    edit: "modification",
    delete: "suppression",
    remove: "suppression",
    login: "auth",
    logout: "auth",
    deploy: "infra",
    deployment: "infra",
    server: "infra",
    scan: "security",
    run: "pipeline",
    trigger: "pipeline",
  };

  if (query.category) {
    const raw = query.category.trim();
    const key = CATEGORY_ALIASES[raw.toLowerCase()] ?? raw.toLowerCase();
    // Si la catégorie est inconnue, on retombe sur une recherche "contains"
    // sur l'action pour ne jamais ignorer silencieusement le filtre.
    const keywords = CATEGORY_KEYWORDS[key] ?? [raw];
    andConditions.push({
      OR: keywords.map((k) => ({ action: { contains: k, mode: "insensitive" as const } })),
    });
  }

  if (query.action) {
    andConditions.push({ action: { contains: query.action, mode: "insensitive" } });
  }

  if (query.targetType) {
    andConditions.push({ targetType: { contains: query.targetType, mode: "insensitive" } });
  }

  if (query.from || query.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) createdAt.lte = new Date(`${query.to}T23:59:59.999Z`);
    andConditions.push({ createdAt });
  }

  if (query.search) {
    andConditions.push({
      OR: [
        { action: { contains: query.search, mode: "insensitive" } },
        { targetType: { contains: query.search, mode: "insensitive" } },
        { targetId: { contains: query.search, mode: "insensitive" } },
        { user: { is: { name: { contains: query.search, mode: "insensitive" } } } },
        { user: { is: { email: { contains: query.search, mode: "insensitive" } } } },
      ],
    });
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
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