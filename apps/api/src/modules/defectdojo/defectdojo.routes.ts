// apps/api/src/modules/defectdojo/defectdojo.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./defectdojo.controller";
import {
  exportDefectDojoSchema,
  testDefectDojoConfigSchema,
  updateDefectDojoConfigSchema,
} from "./defectdojo.schema";

export const defectDojoRouter = Router();

// Configuration globale : ADMIN uniquement
defectDojoRouter.get("/config", requireAuth, requireRole("ADMIN"), controller.getConfig);
defectDojoRouter.put(
  "/config",
  requireAuth,
  requireRole("ADMIN"),
  validate({ body: updateDefectDojoConfigSchema }),
  controller.updateConfig,
);
defectDojoRouter.post(
  "/config/test",
  requireAuth,
  requireRole("ADMIN"),
  validate({ body: testDefectDojoConfigSchema }),
  controller.testConfig,
);

// Export par projet
defectDojoRouter.post(
  "/projects/:projectId/export",
  requireAuth,
  validate({ body: exportDefectDojoSchema }),
  controller.exportPipeline,
);
defectDojoRouter.get(
  "/projects/:projectId/imports",
  requireAuth,
  controller.listImports,
);