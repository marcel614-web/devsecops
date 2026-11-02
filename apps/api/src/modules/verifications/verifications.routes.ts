// apps/api/src/modules/verifications/verifications.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as verificationsController from "./verifications.controller";
import {
  verificationListQuerySchema,
  verificationProjectParamSchema,
} from "./verifications.schema";

export const verificationsRouter = Router({ mergeParams: true });

verificationsRouter.use(requireAuth);

verificationsRouter.get(
  "/",
  validate({
    params: verificationProjectParamSchema,
    query: verificationListQuerySchema,
  }),
  verificationsController.listVerifications,
);
