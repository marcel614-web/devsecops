// apps/api/src/modules/dashboard/dashboard.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as dashboardService from "./dashboard.service";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function getSummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await dashboardService.getDashboardSummary(actor);
    res.json(result);
  } catch (err) {
    next(err);
  }
}