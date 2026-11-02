// apps/worker/src/index.ts
import { logger } from "./utils/logger";
import { prisma } from "./utils/prisma";
import { startPipelineWorker } from "./orchestrator/pipeline.worker";
import { startRescanWorker } from "./rescan/rescan.worker";
import {
  ensureRescanScheduler,
  rescanQueue,
} from "./rescan/rescan.queue";
import {
  destroyAllSandboxes,
  sweepOrphanSandboxes,
  type SandboxLogLevel,
} from "./isolation/sandbox";

function sandboxLogger(level: SandboxLogLevel, message: string): Promise<void> {
  logger[level](message);
  return Promise.resolve();
}

async function main() {
  try {
    await prisma.$connect();
    logger.info("Worker : connexion PostgreSQL OK");

    const worker = startPipelineWorker();
    logger.info("Worker : en écoute sur la queue pipeline-runs");

    const rescanWorker = startRescanWorker();
    await ensureRescanScheduler();
    logger.info(
      "Worker : rescan périodique en écoute (queue rescan-runs, scheduler BullMQ)",
    );

    // Nettoyage best-effort des sandboxes orphelines d'un arrêt brutal.
    void sweepOrphanSandboxes(sandboxLogger).catch(() => undefined);

    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Arrêt du worker");
      // Coupe d'abord les sandboxes actives : une installation bloquée ne
      // doit pas retarder indéfiniment l'arrêt.
      await destroyAllSandboxes().catch(() => undefined);
      await worker.close();
      await rescanWorker.close();
      await rescanQueue.close().catch(() => undefined);
      await prisma.$disconnect();
      process.exit(0);
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  } catch (err) {
    logger.fatal({ err }, "Impossible de démarrer le worker");
    process.exit(1);
  }
}

void main();