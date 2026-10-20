// apps/api/src/modules/notifications/notifications.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as notificationsController from "./notifications.controller";
import {
  clearNotificationsQuerySchema,
  markNotificationSchema,
  notificationIdParamSchema,
  notificationListQuerySchema,
} from "./notifications.schema";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get(
  "/",
  validate({ query: notificationListQuerySchema }),
  notificationsController.listNotifications,
);

notificationsRouter.get(
  "/unread-count",
  notificationsController.getUnreadCount,
);

notificationsRouter.post(
  "/read-all",
  notificationsController.markAllNotificationsRead,
);

notificationsRouter.patch(
  "/:id",
  validate({
    params: notificationIdParamSchema,
    body: markNotificationSchema,
  }),
  notificationsController.markNotificationRead,
);

notificationsRouter.delete(
  "/:id",
  validate({ params: notificationIdParamSchema }),
  notificationsController.deleteNotification,
);

notificationsRouter.delete(
  "/",
  validate({ query: clearNotificationsQuerySchema }),
  notificationsController.clearNotifications,
);
