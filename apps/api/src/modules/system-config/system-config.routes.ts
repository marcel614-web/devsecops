// apps/api/src/modules/system-config/system-config.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./system-config.controller";
import {
  testGithubConfigSchema,
  updateGithubConfigSchema,
} from "./system-config.schema";

export const systemConfigRouter = Router();

// Toutes les routes : ADMIN uniquement
systemConfigRouter.use(requireAuth, requireRole("ADMIN"));

systemConfigRouter.get("/github", controller.getGithubConfig);

systemConfigRouter.put(
  "/github",
  validate({ body: updateGithubConfigSchema }),
  controller.updateGithubConfig,
);

systemConfigRouter.post(
  "/github/test",
  validate({ body: testGithubConfigSchema }),
  controller.testGithubConfig,
);