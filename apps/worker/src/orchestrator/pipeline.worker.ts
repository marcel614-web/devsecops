// apps/worker/src/orchestrator/pipeline.worker.ts
import { Worker } from "bullmq";
import { PIPELINE_QUEUE_NAME, type PipelineJobData } from "../queues/queues";
import { redisConnection } from "../queues/connection";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { runPipeline } from "./pipeline.engine";

/** Message lisible même quand `err.message` est vide (erreurs réseau BullMQ). */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return [err.name, code, err.message].filter(Boolean).join(": ") || "erreur inconnue";
  }
  return String(err);
}

export function startPipelineWorker(): Worker<PipelineJobData> {
  const worker = new Worker<PipelineJobData>(
    PIPELINE_QUEUE_NAME,
    async (job) => {
      logger.info(
        { jobId: job.id, pipelineId: job.data.pipelineId },
        "Job pipeline reçu",
      );
      await runPipeline(job.data.pipelineId);
    },
    {
      connection: redisConnection,
      concurrency: 1,
      lockDuration: 30 * 60_000,
      lockRenewTime: 5 * 60_000,
      stalledInterval: 60_000,
      maxStalledCount: 2,
    },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Job terminé");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: describeError(err) }, "Job échoué");
  });

  // Une coupure Redis fait émettre une erreur toutes les ~2 s : on limite
  // le bruit et on indique la cause réelle (le message est souvent vide).
  let lastRedisErrorAt = 0;

  worker.on("error", (err) => {
    const message = err.message ?? "";

    // Ignore les erreurs de lock (job retiré manuellement).
    if (message.includes("Missing lock") || message.includes("could not renew lock")) {
      logger.debug({ err: describeError(err) }, "Job retiré — lock perdu (attendu)");
      return;
    }

    const code = (err as NodeJS.ErrnoException).code;
    const isRedisIssue =
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "EPIPE";

    if (isRedisIssue) {
      const now = Date.now();
      if (now - lastRedisErrorAt < 30_000) return;
      lastRedisErrorAt = now;

      logger.error(
        { code, host: env.REDIS_HOST, port: env.REDIS_PORT },
        "Worker : connexion Redis perdue — vérifiez Redis/Memurai (npm run ensure:redis)",
      );
      return;
    }

    logger.error({ err: describeError(err) }, "Worker erreur");
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "Job stalled — en attente de reprise");
  });

  return worker;
}