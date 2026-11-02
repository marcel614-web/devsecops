// apps/api/src/modules/dependency-track/dependency-track.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as service from "./dependency-track.service";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function getConfig(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ config: await service.getDependencyTrackConfigPublic() });
  } catch (err) {
    next(err);
  }
}

export async function updateConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const config = await service.updateDependencyTrackConfig(req.body, actor.id);
    res.json({ config });
  } catch (err) {
    next(err);
  }
}

export async function testConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.testDependencyTrackConnection(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
}