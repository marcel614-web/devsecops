// apps/api/src/modules/rescans/rescans.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as rescansService from "./rescans.service";
import type {
  RemediationInput,
  RescanListQuery,
} from "./rescans.schema";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listRescans(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await rescansService.listRescans(
      actorFrom(req),
      req.params.projectId,
      req.query as unknown as RescanListQuery,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getRescan(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const run = await rescansService.getRescan(
      actorFrom(req),
      req.params.projectId,
      req.params.runId,
    );
    res.json({ rescan: run });
  } catch (err) {
    next(err);
  }
}

export async function triggerRescan(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const run = await rescansService.triggerRescan(
      actorFrom(req),
      req.params.projectId,
    );
    res.status(202).json({ rescan: run });
  } catch (err) {
    next(err);
  }
}

export async function cancelRescan(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const run = await rescansService.cancelRescan(
      actorFrom(req),
      req.params.projectId,
      req.params.runId,
    );
    res.json({ rescan: run });
  } catch (err) {
    next(err);
  }
}

export async function createRemediation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const pipeline = await rescansService.createRemediationPipeline(
      actorFrom(req),
      req.params.projectId,
      req.params.runId,
      (req.body ?? {}) as RemediationInput,
    );
    res.status(202).json({ pipeline });
  } catch (err) {
    next(err);
  }
}
