import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as auditService from "./audit.service";
import { Role } from "@prisma/client";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return { id: req.user.id, role: req.user.role as Role };
}

export async function listAuditLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const result = await auditService.listAuditLogs(actor, req.query as any);
    res.json(result);
  } catch (err) {
    next(err);
  }
}