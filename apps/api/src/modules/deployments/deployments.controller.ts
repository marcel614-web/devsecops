import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as deploymentsService from "./deployments.service";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listDeployments(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const items = await deploymentsService.listDeployments(actor);
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

export async function listProjectDeployments(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const actor = actorFrom(req);
    const result = await deploymentsService.listProjectDeployments(
      actor,
      req.params.id,
      {
        page: Number(req.query.page ?? 1),
        pageSize: Number(req.query.pageSize ?? 20),
      },
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getDeployment(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const deployment = await deploymentsService.getDeployment(actor, req.params.id);
    res.json({ deployment });
  } catch (err) {
    next(err);
  }
}

export async function startDeployment(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const result = await deploymentsService.startDeployment(actor, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function stopDeployment(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const result = await deploymentsService.stopDeployment(actor, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function restartDeployment(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const result = await deploymentsService.restartDeployment(actor, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function uninstallDeployment(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    await deploymentsService.uninstallDeployment(actor, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}