import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
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
import { useDismissable } from "@/hooks/useDismissable";
import { cn, timeAgo } from "@/lib/utils";

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const toast = useToast();

  const { data, isLoading, isError, refetch } = useNotifications({ pageSize: 8 });
  const { data: unreadData } = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const items = data?.items ?? [];
  const unreadCount = unreadData?.count ?? 0;
  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(ref, open, close, triggerRef);

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
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} non lue${unreadCount > 1 ? "s" : ""}`
            : "Notifications"
        }
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-slate-200/70 dark:hover:bg-slate-700/60"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-surface"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          // Mobile : pleine largeur sous la barre ; ≥ sm : popover ancré au bouton
          className="fixed inset-x-2 top-14 z-50 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[24rem]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Notifications</h2>
              {unreadCount > 0 && (
                <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
                  {unreadCount} non lue{unreadCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={markAllRead.isPending}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-primary-600 hover:bg-primary-600/10 disabled:opacity-50 dark:text-primary-400"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Tout marquer comme lu
              </button>
            )}
          </div>

          <div className="scrollbar-thin max-h-[min(24rem,70dvh)] overflow-y-auto">
            {isLoading ? (
              <ul aria-busy="true" aria-label="Chargement des notifications">
                {[0, 1, 2].map((n) => (
                  <li key={n} className="flex animate-pulse gap-3 border-b border-border/60 px-4 py-3 last:border-0">
                    <span className="h-8 w-8 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700" />
                    <span className="flex-1 space-y-2">
                      <span className="block h-3 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
                      <span className="block h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : isError ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium">Impossible de charger les notifications.</p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="mt-2 text-sm font-medium text-primary-600 hover:underline dark:text-primary-400"
                >
                  Réessayer
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="mx-auto h-6 w-6 text-muted" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium">Vous êtes à jour</p>
                <p className="text-xs text-muted">Les nouvelles alertes apparaîtront ici.</p>
              </div>
            ) : (
              <ul>
                {items.map((notification) => {
                  const meta = NOTIFICATION_KIND_META[notification.kind];
                  const Icon = meta.icon;
                  const unread = !notification.readAt;
                  return (
                    <li key={notification.id} className="border-b border-border/60 last:border-0">
                      <button
                        type="button"
                        onClick={() => openNotification(notification)}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-700/40",
                          unread && "bg-primary-600/5",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                            meta.iconClassName,
                          )}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("block text-sm", unread && "font-medium")}>
                            {unread && <span className="sr-only">Non lue : </span>}
                            {notification.title}
                          </span>
                          {notification.message && (
                            <span className="mt-0.5 line-clamp-2 block text-xs text-muted">
                              {notification.message}
                            </span>
                          )}
                          <span className="mt-1 block text-[11px] text-muted">
                            {timeAgo(notification.createdAt)}
                          </span>
                        </span>
                        {unread && (
                          <span
                            aria-hidden="true"
                            className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary-500"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
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
