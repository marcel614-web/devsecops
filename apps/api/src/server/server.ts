// apps/api/src/server/server.ts
import http from "node:http";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { createApp } from "./app";

export function startServer(): http.Server {
  const app = createApp();
  const server = http.createServer(app);

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.fatal(
        `Le port ${env.API_PORT} est déjà utilisé. ` +
          "Une autre instance de l'API tourne probablement : arrêtez-la (Ctrl+C) " +
          "ou changez API_PORT dans .env, puis relancez `npm run dev`.",
      );
    } else {
      logger.fatal({ err }, "Erreur du serveur HTTP");
    }
    process.exit(1);
  });

  server.listen(env.API_PORT, () => {
    logger.info(
      { port: env.API_PORT, env: env.NODE_ENV },
      "API DevSecOps démarrée",
    );
  });

  return server;
}