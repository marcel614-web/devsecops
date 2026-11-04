// apps/api/src/server/app.ts
import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { HEADER_REQUEST_ID } from "../config/constants";
import { env, isDev } from "../config/env";
import {
  globalLimiter,
  webhookLimiter,
} from "../middleware/rateLimiter";
import { errorHandler } from "../middleware/errorHandler";
import { rawBodyMiddleware } from "../middleware/rawBody";
import { authRouter } from "../modules/auth/auth.routes";
import { auditRouter } from "../modules/audit/audit.routes";
import { usersRouter } from "../modules/users/users.routes";
import { authorizationRouter } from "../modules/authorization/authorization.routes";
import { projectsRouter } from "../modules/projects/projects.routes";
import { reportsRouter } from "../modules/reports/reports.routes";
import {
  globalPipelinesRouter,
  pipelinesRouter,
} from "../modules/pipelines/pipelines.routes";
import { vulnerabilitiesRouter } from "../modules/vulnerabilities/vulnerabilities.routes";
import { dashboardRouter } from "../modules/dashboard/dashboard.routes";
import { deploymentsRouter } from "../modules/deployments/deployments.routes";
import { serversRouter } from "../modules/servers/servers.routes";
import { githubRouter } from "../modules/github/github.routes";
import { notificationsRouter } from "../modules/notifications/notifications.routes";
import { defectDojoRouter } from "../modules/defectdojo/defectdojo.routes";
import { dependencyTrackRouter } from "../modules/dependency-track/dependency-track.routes";
import { systemConfigRouter } from "../modules/system-config/system-config.routes";
import { rescansRouter } from "../modules/rescans/rescans.routes";
import { verificationsRouter } from "../modules/verifications/verifications.routes";
import { githubWebhook } from "../modules/webhooks/webhooks.controller";

/**
 * Format accepté pour l'en-tête `x-request-id` fourni par le client.
 * Volontairement strict : UUID, identifiant d'outils de tracing ou slug.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Origines autorisées à appeler l'API avec des credentials (cookies).
 *
 * `origin: true` (le comportement par défaut de la lib `cors`) reflète
 * N'IMPORTE QUELLE origine : combiné à `credentials: true`, n'importe quel
 * site pouvait lire les réponses authentifiées de l'API. On n'autorise
 * donc que les origines explicitement configurées.
 */
function buildCorsOrigin(): string[] | ((origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void) {
  const allowed = new Set<string>([env.FRONTEND_URL]);
  // URL de l'API elle-même (utile pour les health checks / tests).
  allowed.add(env.API_URL);
  allowed.add(env.BACKEND_URL);

  return (origin, cb) => {
    // Requête sans en-tête Origin (curl, serveur à serveur, same-origin) :
    // on l'autorise, le contrôle d'accès se fait via l'authentification.
    if (!origin) return cb(null, true);
    if (allowed.has(origin)) return cb(null, true);
    // En développement, on accepte toute origine localhost (Vite peut changer
    // de port dynamiquement si 5173 est déjà occupé → éviter les "Network Error"
    // liés au CORS).
    if (isDev && /^http:\/\/localhost:\d+$/.test(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`Origine non autorisée : ${origin}`));
  };
}

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: buildCorsOrigin(), credentials: true }));

  // ----------------------------------------------------------
  // WEBHOOK : corps BRUT requis AVANT express.json()
  // Le rate limit est appliqué ICI (avant le limiteur global) car la
  // route est montée plus bas : sans cela, ce endpoint public et non
  // authentifié était totalement illimité.
  // ----------------------------------------------------------
  app.post(
    "/api/webhooks/github",
    webhookLimiter,
    rawBodyMiddleware,
    githubWebhook,
  );

  // ----------------------------------------------------------
  // Parsing JSON
  // ----------------------------------------------------------
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // ----------------------------------------------------------
  // Request ID
  // ----------------------------------------------------------
  // L'en-tête `x-request-id` est fourni par le client : on ne l'accepte
  // que s'il respecte un format strict, sinon on génère un UUID.
  // Sans ce contrôle, une valeur contenant CR/LF fait lever une
  // exception dans `res.setHeader` → réponse 500 sur une simple requête.
  // ----------------------------------------------------------
  app.use((req, res, next) => {
    const headerId = req.headers[HEADER_REQUEST_ID];
    const raw = Array.isArray(headerId) ? headerId[0] : headerId;
    const id = raw && REQUEST_ID_PATTERN.test(raw) ? raw : crypto.randomUUID();
    res.locals.requestId = id;
    res.setHeader(HEADER_REQUEST_ID, id);
    next();
  });

  // ----------------------------------------------------------
  // Santé
  // ----------------------------------------------------------
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ----------------------------------------------------------
  // Rate limiting global
  // ----------------------------------------------------------
  app.use(globalLimiter);

  // ----------------------------------------------------------
  // Routes
  // ----------------------------------------------------------
  app.use("/api/auth", authRouter);
app.use("/api/audit-logs", auditRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/authorization", authorizationRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/servers", serversRouter);
  app.use("/api/github", githubRouter);
app.use("/api/notifications", notificationsRouter);
  app.use("/api/defectdojo", defectDojoRouter);
  app.use("/api/dependency-track", dependencyTrackRouter);
  app.use("/api/system-config", systemConfigRouter);

  // ⚠️ Ordre important : sous-routes AVANT la route parente
  app.use("/api/pipelines", globalPipelinesRouter);
  app.use("/api/projects/:projectId/pipelines", pipelinesRouter);
  app.use("/api/projects/:projectId/vulnerabilities", vulnerabilitiesRouter);
  app.use("/api/projects/:projectId/rescans", rescansRouter);
  app.use("/api/projects/:projectId/verifications", verificationsRouter);
  app.use("/api/projects", projectsRouter);
app.use("/api/deployments", deploymentsRouter);
app.use("/api/reports", reportsRouter);

  // ----------------------------------------------------------
  // 404
  // ----------------------------------------------------------
  app.use((_req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Route introuvable" },
    });
  });

  // ----------------------------------------------------------
  // Gestion d'erreurs (en dernier)
  // ----------------------------------------------------------
  app.use(errorHandler);

  return app;
}