// apps/api/src/modules/system-config/system-config.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { requireGlobalPermission } from "../authorization/authorization.middleware";
import { PERMISSIONS } from "../authorization/permissions.constants";
import * as controller from "./system-config.controller";
import {
  testGithubConfigSchema,
  updateGithubConfigSchema,
} from "./system-config.schema";

export const systemConfigRouter = Router();

// Toutes les routes exigent la permission globale de gestion des intégrations.
systemConfigRouter.use(
  requireAuth,
  requireGlobalPermission(PERMISSIONS.INTEGRATION_MANAGE),
);

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