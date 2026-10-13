// apps/worker/src/index.ts
import { logger } from "./utils/logger";
import { prisma } from "./utils/prisma";
import { startPipelineWorker } from "./orchestrator/pipeline.worker";

async function main() {
  try {
    await prisma.$connect();
    logger.info("Worker : connexion PostgreSQL OK");

    const worker = startPipelineWorker();
    logger.info("Worker : en écoute sur la queue pipeline-runs");

    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Arrêt du worker");
      await worker.close();
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