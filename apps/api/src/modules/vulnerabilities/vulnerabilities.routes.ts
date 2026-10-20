// apps/api/src/modules/vulnerabilities/vulnerabilities.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as vulnerabilitiesController from "./vulnerabilities.controller";
import {
  projectIdParamSchema,
  updateVulnerabilitySchema,
  vulnerabilityListQuerySchema,
  vulnerabilityParamSchema,
} from "./vulnerabilities.schema";

export const vulnerabilitiesRouter = Router({ mergeParams: true });

vulnerabilitiesRouter.use(requireAuth);

// Important : /summary doit être déclaré avant /:id.
vulnerabilitiesRouter.get(
  "/summary",
  validate({ params: projectIdParamSchema }),
  vulnerabilitiesController.getVulnerabilitySummary,
);

vulnerabilitiesRouter.get(
  "/",
  validate({
    params: projectIdParamSchema,
    query: vulnerabilityListQuerySchema,
  }),
  vulnerabilitiesController.listVulnerabilities,
);

vulnerabilitiesRouter.patch(
  "/:id",
  validate({
    params: vulnerabilityParamSchema,
    body: updateVulnerabilitySchema,
  }),
  vulnerabilitiesController.updateVulnerability,
);
