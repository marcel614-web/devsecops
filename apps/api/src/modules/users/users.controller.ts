// apps/api/src/modules/users/users.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as usersService from "./users.service";
import type {
  CreateUserInput,
  UpdateUserInput,
  UserListQuery,
} from "./users.schema";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listUsers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await usersService.listUsers(
      actor,
      req.query as unknown as UserListQuery,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const user = await usersService.getUserById(actor, req.params.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function createUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const user = await usersService.createUser(
      actor,
      req.body as CreateUserInput,
    );
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

export async function updateUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const user = await usersService.updateUser(
      actor,
      req.params.id,
      req.body as UpdateUserInput,
    );
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function deleteUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const user = await usersService.deleteUser(actor, req.params.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}