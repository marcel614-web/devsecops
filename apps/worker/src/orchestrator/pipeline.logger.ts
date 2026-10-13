// apps/worker/src/orchestrator/pipeline.logger.ts
import { prisma } from "../utils/prisma";
import { logger } from "../utils/logger";

/**
 * Persiste un log dans PipelineLog, puis logue côté worker.
 */
export async function logStep(
  pipelineId: string,
  stepId: string | null,
  level: "info" | "warn" | "error" | "debug",
  message: string,
): Promise<void> {
  try {
    const count = await prisma.pipelineLog.count({ where: { pipelineId } });

    await prisma.pipelineLog.create({
      data: {
        pipelineId,
        stepId,
        level,
        message,
        sequence: count + 1,
      },
    });
  } catch (err) {
    logger.warn({ err }, "Échec d'écriture PipelineLog");
  }

  if (level === "error") {
    logger.error({ pipelineId, stepId }, message);
  } else if (level === "warn") {
    logger.warn({ pipelineId, stepId }, message);
  } else if (level === "debug") {
    logger.debug({ pipelineId, stepId }, message);
  } else {
    logger.info({ pipelineId, stepId }, message);
  }
}