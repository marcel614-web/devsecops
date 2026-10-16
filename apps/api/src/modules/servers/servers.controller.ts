// apps/api/src/modules/servers/servers.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as serversService from "./servers.service";
import type {
  CreateServerInput,
  ServerListQuery,
  UpdateServerInput,
} from "./servers.schema";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listServers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await serversService.listServers(
      actor,
      req.query as unknown as ServerListQuery,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getServer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const server = await serversService.getServer(actor, req.params.id);
    res.json({ server });
  } catch (err) {
    next(err);
  }
}

export async function createServer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const server = await serversService.createServer(
      actor,
      req.body as CreateServerInput,
    );
    res.status(201).json({ server });
  } catch (err) {
    next(err);
  }
}

export async function updateServer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const server = await serversService.updateServer(
      actor,
      req.params.id,
      req.body as UpdateServerInput,
    );
    res.json({ server });
  } catch (err) {
    next(err);
  }
}

export async function deleteServer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    await serversService.deleteServer(actor, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// apps/api/src/modules/servers/servers.controller.ts (ajout)

export async function testServer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const response = await serversService.testServer(actor, req.params.id);
    res.json(response);
  } catch (err) {
    next(err);
  }
}

export async function cleanupDockerImages(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await serversService.cleanupDockerImages(actor, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
