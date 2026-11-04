import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as auditController from "./audit.controller";
import { auditListQuerySchema } from "./audit.schema";

export const auditRouter = Router();

auditRouter.use(requireAuth);

auditRouter.get(
  "/",
  validate({ query: auditListQuerySchema }),
  auditController.listAuditLogs,
);