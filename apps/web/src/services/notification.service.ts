// apps/web/src/services/notification.service.ts
import { api } from "./api";

export type NotificationKind = "SUCCESS" | "WARNING" | "DANGER" | "INFO";
export type NotificationStatus = "all" | "unread" | "read";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationCounts {
  all: number;
  unread: number;
  read: number;
}

export interface NotificationListResponse {
  items: AppNotification[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  unreadCount: number;
  counts: NotificationCounts;
  globalCounts: NotificationCounts;
}

export interface NotificationListParams {
  page?: number;
  pageSize?: number;
  status?: NotificationStatus;
  kind?: NotificationKind;
  search?: string;
}

export const notificationService = {
  list: (params: NotificationListParams = {}) =>
    api
      .get<NotificationListResponse>("/api/notifications", { params })
      .then((r) => r.data),

  unreadCount: () =>
    api
      .get<{ count: number }>("/api/notifications/unread-count")
      .then((r) => r.data),

  markRead: (id: string, read = true) =>
    api
      .patch<{ updated: number }>(`/api/notifications/${id}`, { read })
      .then((r) => r.data),

  markAllRead: () =>
    api
      .post<{ updated: number }>("/api/notifications/read-all")
      .then((r) => r.data),

  remove: (id: string) =>
    api
      .delete<{ deleted: number }>(`/api/notifications/${id}`)
      .then((r) => r.data),

  clear: (scope: "all" | "read" = "all") =>
    api
      .delete<{ deleted: number }>("/api/notifications", {
        params: { scope },
      })
      .then((r) => r.data),
};
