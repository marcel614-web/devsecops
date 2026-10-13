// apps/api/src/index.ts
import { logger } from "./utils/logger";
import { startServer } from "./server/server";
import { prisma } from "./utils/prisma";

async function main() {
  try {
    // Vérifie la connexion BDD au démarrage
    await prisma.$connect();
    logger.info("Connexion PostgreSQL OK");

    const server = startServer();

    // Arrêt propre
    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Arrêt de l'API");
      server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
      });
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  } catch (err) {
    logger.fatal({ err }, "Impossible de démarrer l'API");
    process.exit(1);
  }
}

void main();