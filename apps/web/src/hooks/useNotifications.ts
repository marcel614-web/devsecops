// apps/web/src/hooks/useNotifications.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  notificationService,
  type NotificationListParams,
} from "@/services/notification.service";

const NOTIFICATIONS_KEY = ["notifications"] as const;
const UNREAD_KEY = ["notifications-unread"] as const;

export function useNotifications(params: NotificationListParams = {}) {
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, params],
    queryFn: () => notificationService.list(params),
    refetchInterval: 30_000,
  });
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: UNREAD_KEY,
    queryFn: notificationService.unreadCount,
    refetchInterval: 30_000,
  });
}

function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    qc.invalidateQueries({ queryKey: UNREAD_KEY });
  };
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) =>
      notificationService.markRead(id, read),
    onSuccess: invalidate,
  });
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: invalidate,
  });
}

export function useDeleteNotification() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: (id: string) => notificationService.remove(id),
    onSuccess: invalidate,
  });
}

export function useClearNotifications() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: (scope: "all" | "read") => notificationService.clear(scope),
    onSuccess: invalidate,
  });
}
