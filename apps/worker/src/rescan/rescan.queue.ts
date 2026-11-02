// apps/worker/src/rescan/rescan.queue.ts
import { Queue } from "bullmq";
import {
  RESCAN_QUEUE_NAME,
  RESCAN_SCHEDULER_ID,
  RESCAN_TICK_JOB,
  type RescanJobData,
} from "@devsecops/shared";
import { redisConnection } from "../queues/connection";

const SCHEDULER_INTERVAL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.RESCAN_SCHEDULER_INTERVAL_MS ?? "", 10) ||
    5 * 60_000,
);

export const rescanQueue = new Queue<RescanJobData>(RESCAN_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
    removeOnFail: { age: 30 * 24 * 3600, count: 1000 },
  },
});

/**
 * Un seul job scheduler BullMQ, idempotent, pour toute la plateforme.
 * Il ne fait que sélectionner les politiques arrivées à échéance ; chaque
 * rescan est ensuite un job distinct avec un identifiant unique.
 */
export async function ensureRescanScheduler(): Promise<void> {
  await rescanQueue.upsertJobScheduler(
    RESCAN_SCHEDULER_ID,
    { every: SCHEDULER_INTERVAL_MS },
    {
      name: RESCAN_TICK_JOB,
      data: {},
      opts: {
        removeOnComplete: { age: 24 * 3600, count: 100 },
        removeOnFail: { age: 7 * 24 * 3600, count: 100 },
      },
    },
  );
}
