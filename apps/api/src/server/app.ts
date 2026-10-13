// apps/api/src/server/app.ts
import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { HEADER_REQUEST_ID } from "../config/constants";
import { globalLimiter } from "../middleware/rateLimiter";
import { errorHandler } from "../middleware/errorHandler";
import { authRouter } from "../modules/auth/auth.routes";
import { usersRouter } from "../modules/users/users.routes";
import { projectsRouter } from "../modules/projects/projects.routes";
import { pipelinesRouter } from "../modules/pipelines/pipelines.routes";
import { vulnerabilitiesRouter } from "../modules/vulnerabilities/vulnerabilities.routes";
import { dashboardRouter } from "../modules/dashboard/dashboard.routes";
import { serversRouter } from "../modules/servers/servers.routes";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    const headerId = req.headers[HEADER_REQUEST_ID];
    const id =
      (Array.isArray(headerId) ? headerId[0] : headerId) ?? crypto.randomUUID();
    res.locals.requestId = id;
    res.setHeader(HEADER_REQUEST_ID, id);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(globalLimiter);

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/servers", serversRouter);

  // ⚠️ Ordre important : les sous-routes avec param doivent être montées
  // AVANT la route parente qui matche n'importe quel :id.
  app.use("/api/projects/:projectId/pipelines", pipelinesRouter);
  app.use("/api/projects/:projectId/vulnerabilities", vulnerabilitiesRouter);
  app.use("/api/projects", projectsRouter);

  app.use((_req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Route introuvable" },
    });
  });

  app.use(errorHandler);
  return app;
}