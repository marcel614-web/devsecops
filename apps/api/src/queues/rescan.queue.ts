// apps/api/src/queues/rescan.queue.ts
import { Queue } from "bullmq";
import {
  RESCAN_QUEUE_NAME,
  RESCAN_RUN_JOB,
  type RescanJobData,
} from "@devsecops/shared";
import { env } from "../config/env";
import { logger } from "../utils/logger";

/**
 * Même queue Redis/BullMQ que celle consommée par le worker. L'API ne
 * planifie jamais elle-même : elle ajoute un job unique par rescan manuel.
 */
export const rescanQueue = new Queue<RescanJobData>(RESCAN_QUEUE_NAME, {
  connection: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  },
  defaultJobOptions: {
    removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
    removeOnFail: { age: 30 * 24 * 3600, count: 1000 },
  },
});

rescanQueue.on("error", (err) => {
  logger.warn(
    { error: err instanceof Error ? err.message : String(err) },
    "Queue rescan : erreur Redis",
  );
});

export async function enqueueRescanRun(
  rescanRunId: string,
): Promise<void> {
  await rescanQueue.add(
    RESCAN_RUN_JOB,
    { rescanRunId },
    {
      jobId: `rescan:${rescanRunId}`,
      attempts: 2,
      backoff: { type: "exponential", delay: 60_000 },
    },
  );
}
