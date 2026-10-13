// apps/api/src/modules/vulnerabilities/vulnerabilities.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as vulnerabilitiesController from "./vulnerabilities.controller";
import {
  projectIdParamSchema,
  vulnerabilityListQuerySchema,
} from "./vulnerabilities.schema";

export const vulnerabilitiesRouter = Router({ mergeParams: true });

vulnerabilitiesRouter.use(requireAuth);

vulnerabilitiesRouter.get(
  "/",
  validate({
    params: projectIdParamSchema,
    query: vulnerabilityListQuerySchema,
  }),
  vulnerabilitiesController.listVulnerabilities,
);