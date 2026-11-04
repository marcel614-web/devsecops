// apps/api/src/modules/defectdojo/defectdojo.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  requireGlobalPermission,
  requireProjectPermission,
} from "../authorization/authorization.middleware";
import { PERMISSIONS } from "../authorization/permissions.constants";
import * as controller from "./defectdojo.controller";
import {
  exportDefectDojoSchema,
  testDefectDojoConfigSchema,
  updateDefectDojoConfigSchema,
} from "./defectdojo.schema";

export const defectDojoRouter = Router();

// Configuration globale : permission d'intégration requise.
defectDojoRouter.get(
  "/config",
  requireAuth,
  requireGlobalPermission(PERMISSIONS.INTEGRATION_MANAGE),
  controller.getConfig,
);
defectDojoRouter.put(
  "/config",
  requireAuth,
  requireGlobalPermission(PERMISSIONS.INTEGRATION_MANAGE),
  validate({ body: updateDefectDojoConfigSchema }),
  controller.updateConfig,
);
defectDojoRouter.post(
  "/config/test",
  requireAuth,
  requireGlobalPermission(PERMISSIONS.INTEGRATION_MANAGE),
  validate({ body: testDefectDojoConfigSchema }),
  controller.testConfig,
);

// Export par projet
defectDojoRouter.post(
  "/projects/:projectId/export",
  requireAuth,
  requireProjectPermission(PERMISSIONS.SECURITY_REPORT_EXPORT),
  validate({ body: exportDefectDojoSchema }),
  controller.exportPipeline,
);
defectDojoRouter.get(
  "/projects/:projectId/imports",
  requireAuth,
  requireProjectPermission(PERMISSIONS.SECURITY_REPORT_READ),
  controller.listImports,
);