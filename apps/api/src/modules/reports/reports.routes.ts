import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as reportsController from "./reports.controller";
import { reportListQuerySchema, reportIdParamSchema } from "./reports.schema";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get(
  "/",
  validate({ query: reportListQuerySchema }),
  reportsController.listReports,
);

reportsRouter.get(
  "/:id",
  validate({ params: reportIdParamSchema }),
  reportsController.getReport,
);