import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as reportsService from "./reports.service";
import type { ActorContext } from "./reports.service";
import { Role } from "@prisma/client";

function actorFrom(req: Request): ActorContext {
  if (!req.user) throw new UnauthorizedError();
  return { id: req.user.id, role: req.user.role as Role };
}

export async function listReports(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const result = await reportsService.listReports(actor, req.query as any);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getReport(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const report = await reportsService.getReport(actor, req.params.id);
    res.json({ report });
  } catch (err) {
    next(err);
  }
}