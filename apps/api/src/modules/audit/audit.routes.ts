import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as auditController from "./audit.controller";
import { auditListQuerySchema } from "./audit.schema";

export const auditRouter = Router();

auditRouter.use(requireAuth, requireRole("ADMIN"));

auditRouter.get(
  "/",
  validate({ query: auditListQuerySchema }),
  auditController.listAuditLogs,
);