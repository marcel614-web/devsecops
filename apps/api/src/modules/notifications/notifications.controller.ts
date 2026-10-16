import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as notificationsService from "./notifications.service";
import { Role } from "@prisma/client";

export async function listNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new UnauthorizedError();
    const items = await notificationsService.listNotifications({
      id: req.user.id,
      role: req.user.role as Role,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
}