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
      // Le job peut durer jusqu'à 30 min (Docker build).
      // On augmente le lock pour éviter la perte de job.
      lockDuration: 30 * 60_000, // 30 min
      lockRenewTime: 5 * 60_000, // renouvelle toutes les 5 min
      stalledInterval: 60_000, // vérifie les jobs stalled toutes les 60s
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
    logger.error({ err: err.message }, "Worker erreur");
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "Job stalled — en attente de reprise");
  });

  return worker;
}