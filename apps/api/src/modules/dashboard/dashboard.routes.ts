// apps/api/src/modules/dashboard/dashboard.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import * as dashboardController from "./dashboard.controller";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/summary", dashboardController.getSummary);