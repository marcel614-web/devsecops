// apps/api/src/modules/dependency-track/dependency-track.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./dependency-track.controller";
import {
  testDependencyTrackConfigSchema,
  updateDependencyTrackConfigSchema,
} from "./dependency-track.schema";

export const dependencyTrackRouter = Router();

dependencyTrackRouter.use(requireAuth, requireRole("ADMIN"));

dependencyTrackRouter.get("/config", controller.getConfig);
dependencyTrackRouter.put(
  "/config",
  validate({ body: updateDependencyTrackConfigSchema }),
  controller.updateConfig,
);
dependencyTrackRouter.post(
  "/config/test",
  validate({ body: testDependencyTrackConfigSchema }),
  controller.testConfig,
);