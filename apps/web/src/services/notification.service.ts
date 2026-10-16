import { api } from "./api";

export interface AppNotification {
  id: string;
  title: string;
  kind: "success" | "warning" | "danger" | "info";
  time: string;
  link?: string;
}

export const notificationService = {
  list: () => api.get<{ items: AppNotification[] }>("/api/notifications").then((r) => r.data.items),
};