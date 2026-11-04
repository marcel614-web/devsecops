// apps/api/src/modules/authorization/authorization.audit.ts
import { Prisma } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { logWarn } from "../../utils/logger";

export interface AuditInput {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  projectId?: string | null;
  result?: "SUCCESS" | "DENIED" | "ERROR";
  origin?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
}

/**
 * Écriture d'audit non bloquante. Ne jamais y placer de mot de passe, jeton,
 * clé privée ou secret : seuls des identifiants et métadonnées minimales.
 */
export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        projectId: input.projectId ?? null,
        result: input.result ?? "SUCCESS",
        origin: input.origin ?? "api",
        metadataJson: input.metadata,
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });
  } catch (err) {
    logWarn("Échec d'écriture du journal d'audit", {
      action: input.action,
      actorId: input.actorId ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function auditDenied(input: {
  actorId: string;
  permission: string;
  projectId?: string | null;
  targetType?: string;
  targetId?: string;
}): Promise<void> {
  await writeAuditLog({
    actorId: input.actorId,
    action: "ACCESS_DENIED",
    targetType: input.targetType,
    targetId: input.targetId,
    projectId: input.projectId ?? null,
    result: "DENIED",
    metadata: { permission: input.permission },
  });
}
