// apps/api/src/index.ts
import { logger } from "./utils/logger";
import { startServer } from "./server/server";
import { prisma } from "./utils/prisma";

// ============================================================
// PATCH BIGINT POUR JSON.STRINGIFY
// ============================================================
// Prisma retourne des BigInt pour les champs "BigInt" (ex: DockerImage.sizeBytes).
// JSON.stringify ne sait pas les sérialiser → on les convertit en string.
// Doit être fait AVANT tout appel à res.json().
declare global {
  interface BigInt {
    toJSON(): string;
  }
}

BigInt.prototype.toJSON = function (): string {
  return this.toString();
};

// ============================================================
// DÉMARRAGE
// ============================================================
async function main() {
  try {
    await prisma.$connect();
    logger.info("Connexion PostgreSQL OK");

    const server = startServer();

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