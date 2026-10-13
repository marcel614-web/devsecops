// apps/worker/src/queues/queues.ts

/**
 * Noms des queues BullMQ. Doit correspondre aux constantes de l'API.
 */
export const PIPELINE_QUEUE_NAME = "pipeline-runs";

export interface PipelineJobData {
  pipelineId: string;
}