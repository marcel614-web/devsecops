// apps/worker/src/orchestrator/pipeline.authorization.ts
import { PipelineStatus, ProjectMemberStatus, Role, UserStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { logger } from "../utils/logger";

/**
 * Revérifie les droits au moment où le job est réellement exécuté.
 *
 * Un job BullMQ peut rester en file longtemps (ou être injecté/modifié dans
 * Redis). On ne fait donc jamais confiance aux contrôles effectués par l'API
 * au moment de l'enqueue : si le déclencheur a perdu son accès, le job échoue
 * et le pipeline est marqué FAILED.
 *
 * Les pipelines déclenchés par webhook (triggeredById null) restent autorisés :
 * leur authenticité a été vérifiée par la signature GitHub au moment de la
 * réception, et ils appartiennent à un projet déjà associé au dépôt.
 */
export async function assertPipelineJobAuthorized(
  pipelineId: string,
): Promise<void> {
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    select: {
      id: true,
      projectId: true,
      status: true,
      triggeredById: true,
    },
  });

  if (!pipeline) {
    throw new Error("Pipeline introuvable : job refusé");
  }
  if (
    pipeline.status !== PipelineStatus.QUEUED &&
    pipeline.status !== PipelineStatus.RUNNING
  ) {
    throw new Error(`Pipeline dans un état non exécutable : ${pipeline.status}`);
  }
  if (!pipeline.triggeredById) return;

  const [user, project, membership] = await Promise.all([
    prisma.user.findUnique({
      where: { id: pipeline.triggeredById },
      select: { id: true, role: true, status: true, isActive: true },
    }),
    prisma.project.findUnique({
      where: { id: pipeline.projectId },
      select: { ownerId: true },
    }),
    prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: pipeline.projectId,
          userId: pipeline.triggeredById,
        },
      },
      select: { status: true },
    }),
  ]);

  if (!project) {
    throw new Error("Projet introuvable : job refusé");
  }
  if (!user || !user.isActive || user.status !== UserStatus.ACTIVE) {
    throw new Error("Déclencheur inactif ou suspendu : job refusé");
  }

  const isAdmin =
    user.role === Role.PLATFORM_ADMIN || user.role === Role.ADMIN;
  const isActiveMember =
    membership?.status === ProjectMemberStatus.ACTIVE ||
    project.ownerId === user.id;

  if (!isAdmin && !isActiveMember) {
    throw new Error("Déclencheur sans accès actif au projet : job refusé");
  }
}

/**
 * Marque le pipeline en échec et journalise le refus. Appelé uniquement quand
 * l'autorisation asynchrone échoue, avant toute exécution d'étape.
 */
export async function rejectPipelineJob(
  pipelineId: string,
  reason: string,
): Promise<void> {
  try {
    const pipeline = await prisma.pipeline.update({
      where: { id: pipelineId },
      data: {
        status: PipelineStatus.FAILED,
        finishedAt: new Date(),
      },
      select: { projectId: true, triggeredById: true },
    });
    await prisma.auditLog.create({
      data: {
        userId: pipeline.triggeredById,
        action: "PIPELINE_JOB_DENIED",
        targetType: "Pipeline",
        targetId: pipelineId,
        projectId: pipeline.projectId,
        result: "DENIED",
        metadataJson: { reason },
      },
    });
  } catch (err) {
    logger.error(
      {
        pipelineId,
        error: err instanceof Error ? err.message : String(err),
      },
      "Impossible de marquer le pipeline refusé comme FAILED",
    );
  }
}
