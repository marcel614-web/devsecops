// apps/web/src/components/layout/NotificationCenter.tsx
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bell,
  CheckCheck,
} from "lucide-react";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from "@/hooks/useNotifications";
import { useToast } from "@/components/feedback/Toast";
import { getErrorMessage } from "@/services/api";
import { type AppNotification } from "@/services/notification.service";
import { NOTIFICATION_KIND_META } from "@/lib/notificationMeta";
import { cn, timeAgo } from "@/lib/utils";

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const toast = useToast();

  const { data } = useNotifications({ pageSize: 8 });
  const { data: unreadData } = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const items = data?.items ?? [];
  const unreadCount = unreadData?.count ?? 0;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const openNotification = (notification: AppNotification) => {
    if (!notification.readAt) {
      markRead.mutate({ id: notification.id, read: true });
    }
    setOpen(false);
    if (notification.link) navigate(notification.link);
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined, {
      onSuccess: () => toast.show("success", "Toutes les notifications sont lues"),
      onError: (err) => toast.show("error", getErrorMessage(err)),
    });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-slate-200/70 dark:hover:bg-slate-700/60"
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} non lue${unreadCount > 1 ? "s" : ""}`
            : "Notifications"
        }
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Notifications</p>
              {unreadCount > 0 && (
                <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={markAllRead.isPending}
                className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline disabled:opacity-50 dark:text-primary-400"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Tout marquer lu
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                Aucune notification.
              </p>
            ) : (
              items.map((notification) => {
                const meta = NOTIFICATION_KIND_META[notification.kind];
                const Icon = meta.icon;
                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => openNotification(notification)}
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/40",
                      !notification.readAt && "bg-primary-600/5",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                        meta.iconClassName,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-sm",
                          !notification.readAt && "font-medium",
                        )}
                      >
                        {notification.title}
                      </span>
                      {notification.message && (
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {notification.message}
                        </span>
                      )}
                      <span className="mt-1 block text-[11px] text-muted">
                        {timeAgo(notification.createdAt)}
                      </span>
                    </span>
                    {!notification.readAt && (
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2.5 text-center text-xs font-medium text-primary-600 hover:bg-slate-100 dark:text-primary-400 dark:hover:bg-slate-700/40"
          >
            Voir toutes les notifications
          </Link>
        </div>
      )}
    </div>
  );
}
