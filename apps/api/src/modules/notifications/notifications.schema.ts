// apps/api/src/modules/notifications/notifications.schema.ts
import { z } from "zod";
import { NotificationKind } from "@prisma/client";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants";

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  status: z.enum(["all", "unread", "read"]).default("all"),
  kind: z.nativeEnum(NotificationKind).optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

export const notificationIdParamSchema = z.object({
  id: z.string().min(1),
});

export const markNotificationSchema = z.object({
  read: z.boolean().default(true),
});

export const clearNotificationsQuerySchema = z.object({
  scope: z.enum(["all", "read"]).default("all"),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type MarkNotificationInput = z.infer<typeof markNotificationSchema>;
export type ClearNotificationsQuery = z.infer<typeof clearNotificationsQuerySchema>;
