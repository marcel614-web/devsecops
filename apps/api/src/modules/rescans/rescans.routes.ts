// apps/api/src/modules/rescans/rescans.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as rescansController from "./rescans.controller";
import {
  remediationSchema,
  rescanListQuerySchema,
  rescanProjectParamSchema,
  rescanRunParamSchema,
} from "./rescans.schema";

export const rescansRouter = Router({ mergeParams: true });

rescansRouter.use(requireAuth);

rescansRouter.get(
  "/",
  validate({ params: rescanProjectParamSchema, query: rescanListQuerySchema }),
  rescansController.listRescans,
);

rescansRouter.post(
  "/",
  validate({ params: rescanProjectParamSchema }),
  rescansController.triggerRescan,
);

rescansRouter.get(
  "/:runId",
  validate({ params: rescanRunParamSchema }),
  rescansController.getRescan,
);

rescansRouter.post(
  "/:runId/cancel",
  validate({ params: rescanRunParamSchema }),
  rescansController.cancelRescan,
);

rescansRouter.post(
  "/:runId/remediation",
  validate({ params: rescanRunParamSchema, body: remediationSchema }),
  rescansController.createRemediation,
);
