// apps/worker/src/utils/cancellation.ts
import { redisConnection } from "../queues/connection";

// ⚠️ Doit correspondre à PIPELINE_CANCEL_PREFIX dans
// apps/api/src/modules/pipelines/pipelines.service.ts
const PIPELINE_CANCEL_PREFIX = "pipeline:cancel:";

/**
 * Vérifie si une demande d'annulation a été posée pour ce pipeline.
 * Lecture rapide (O(1) sur Redis).
 */
export async function isPipelineCancelled(pipelineId: string): Promise<boolean> {
  const result = await redisConnection.exists(
    `${PIPELINE_CANCEL_PREFIX}${pipelineId}`,
  );
  return result === 1;
}

/**
 * Nettoie le flag d'annulation après traitement.
 * Appelé à la fin du pipeline, quelle que soit l'issue.
 */
export async function clearPipelineCancellation(
  pipelineId: string,
): Promise<void> {
  await redisConnection.del(`${PIPELINE_CANCEL_PREFIX}${pipelineId}`);
}