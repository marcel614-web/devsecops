// apps/api/src/modules/verifications/verifications.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as verificationsService from "./verifications.service";
import type { VerificationListQuery } from "./verifications.schema";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listVerifications(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await verificationsService.listVerifications(
      actorFrom(req),
      req.params.projectId,
      req.query as unknown as VerificationListQuery,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
