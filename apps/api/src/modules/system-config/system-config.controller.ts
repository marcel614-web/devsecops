// apps/api/src/modules/system-config/system-config.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as systemConfigService from "./system-config.service";
import type {
  TestGithubConfigInput,
  UpdateGithubConfigInput,
} from "./system-config.schema";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function getGithubConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    actorFrom(req);
    const config = await systemConfigService.getGithubConfigPublic();
    res.json({ config });
  } catch (err) {
    next(err);
  }
}

export async function updateGithubConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const config = await systemConfigService.updateGithubConfig(
      req.body as UpdateGithubConfigInput,
      actor.id,
    );
    res.json({ config });
  } catch (err) {
    next(err);
  }
}

export async function testGithubConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    actorFrom(req);
    const result = await systemConfigService.testGithubConfig(
      req.body as TestGithubConfigInput,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}