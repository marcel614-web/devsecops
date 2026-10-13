// apps/api/src/modules/vulnerabilities/vulnerabilities.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as vulnerabilitiesService from "./vulnerabilities.service";
import type { VulnerabilityListQuery } from "./vulnerabilities.schema";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listVulnerabilities(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await vulnerabilitiesService.listVulnerabilities(
      actor,
      req.params.projectId,
      req.query as unknown as VulnerabilityListQuery,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}