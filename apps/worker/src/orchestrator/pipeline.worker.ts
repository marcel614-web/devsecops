// apps/worker/src/orchestrator/pipeline.worker.ts
import { Worker } from "bullmq";
import { PIPELINE_QUEUE_NAME, type PipelineJobData } from "../queues/queues";
import { redisConnection } from "../queues/connection";
import { logger } from "../utils/logger";
import { runPipeline } from "./pipeline.engine";

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
    logger.error({ jobId: job?.id, err: err.message }, "Job échoué");
  });

  worker.on("error", (err) => {
    // Ignore les erreurs de lock (job retiré manuellement).
    if (err.message.includes("Missing lock") || err.message.includes("could not renew lock")) {
      logger.debug({ err: err.message }, "Job retiré — lock perdu (attendu)");
      return;
    }
    logger.error({ err: err.message }, "Worker erreur");
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "Job stalled — en attente de reprise");
  });

  return worker;
}