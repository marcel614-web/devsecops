// apps/api/src/queues/pipeline.queue.ts
import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const PIPELINE_QUEUE_NAME = "pipeline-runs";

export interface PipelineJobData {
  pipelineId: string;
}

/**
 * Queue productrice utilisée par l'API.
 * Le worker consomme la même queue.
 */
export const pipelineQueue = new Queue<PipelineJobData>(PIPELINE_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1, // un pipeline ne se réessaie pas automatiquement
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});