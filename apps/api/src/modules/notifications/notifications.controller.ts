// apps/api/src/modules/notifications/notifications.controller.ts
import type { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { UnauthorizedError } from "../../utils/errors";
import * as notificationsService from "./notifications.service";
import type {
  ClearNotificationsQuery,
  MarkNotificationInput,
  NotificationListQuery,
} from "./notifications.schema";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return {
    id: req.user.id,
    role: req.user.role as Role,
  };
}

export async function listNotifications(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await notificationsService.listNotifications(
      actor,
      req.query as unknown as NotificationListQuery,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getUnreadCount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await notificationsService.getUnreadCount(actor);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function markNotificationRead(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await notificationsService.markNotificationRead(
      actor,
      req.params.id,
      req.body as MarkNotificationInput,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function markAllNotificationsRead(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await notificationsService.markAllNotificationsRead(actor);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function deleteNotification(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await notificationsService.deleteNotification(
      actor,
      req.params.id,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function clearNotifications(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await notificationsService.clearNotifications(
      actor,
      (req.query as unknown as ClearNotificationsQuery).scope,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
