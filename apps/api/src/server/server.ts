// apps/api/src/server/server.ts
import http from "node:http";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { createApp } from "./app";

export function startServer(): http.Server {
  const app = createApp();
  const server = http.createServer(app);

  server.listen(env.API_PORT, () => {
    logger.info(
      { port: env.API_PORT, env: env.NODE_ENV },
      "API DevSecOps démarrée",
    );
  });

  return server;
}