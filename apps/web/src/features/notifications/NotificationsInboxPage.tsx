// apps/web/src/features/notifications/NotificationsInboxPage.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BellOff,
  Check,
  CheckCheck,
  Mail,
  MailOpen,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { SearchInput } from "@/components/ui/SearchInput";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/feedback/Toast";
import {
  useClearNotifications,
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from "@/hooks/useNotifications";
import { getErrorMessage } from "@/services/api";
import {
  type AppNotification,
  type NotificationKind,
  type NotificationStatus,
} from "@/services/notification.service";
import {
  NOTIFICATION_KIND_META,
  NOTIFICATION_KIND_OPTIONS,
} from "@/lib/notificationMeta";
import { cn, timeAgo } from "@/lib/utils";

type ConfirmationScope = "all" | "read" | null;

const STATUS_TABS: Array<{
  key: NotificationStatus;
  label: string;
  countKey: "all" | "unread" | "read";
}> = [
  { key: "all", label: "Toutes", countKey: "all" },
  { key: "unread", label: "Non lues", countKey: "unread" },
  { key: "read", label: "Lues", countKey: "read" },
];

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

export function NotificationsInboxPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [status, setStatus] = useState<NotificationStatus>("all");
  const [kind, setKind] = useState<NotificationKind | "">("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [confirmation, setConfirmation] = useState<ConfirmationScope>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const params = useMemo(
    () => ({
      page,
      pageSize: 20,
      status,
      kind: kind || undefined,
      search: debouncedSearch || undefined,
    }),
    [page, status, kind, debouncedSearch],
  );

  const { data, isLoading, isError, error, refetch, isFetching } =
    useNotifications(params);
  const { data: unreadData } = useUnreadNotificationCount();

  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const deleteNotification = useDeleteNotification();
  const clearNotifications = useClearNotifications();

  const items = data?.items ?? [];
  const counts = data?.counts ?? { all: 0, unread: 0, read: 0 };
  const globalCounts = data?.globalCounts ?? { all: 0, unread: 0, read: 0 };
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const globalUnread = unreadData?.count ?? 0;

  useEffect(() => {
    if (data && data.totalPages > 0 && page > data.totalPages) {
      setPage(data.totalPages);
    }
  }, [data, page]);

  const hasFilters = !!debouncedSearch || !!kind || status !== "all";

  const resetFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setKind("");
    setStatus("all");
    setPage(1);
  };

  const markAsRead = (notification: AppNotification) => {
    if (notification.readAt) return;
    markRead.mutate(
      { id: notification.id, read: true },
      {
        onError: (err) => toast.show("error", getErrorMessage(err)),
      },
    );
  };

  const handleToggleRead = (notification: AppNotification) => {
    const read = !notification.readAt;
    markRead.mutate(
      { id: notification.id, read },
      {
        onSuccess: () => {
          toast.show(
            "success",
            read
              ? "Notification marquée comme lue"
              : "Notification marquée comme non lue",
          );
          if (
            items.length === 1 &&
            page > 1 &&
            ((status === "unread" && read) ||
              (status === "read" && !read))
          ) {
            setPage(page - 1);
          }
        },
        onError: (err) => toast.show("error", getErrorMessage(err)),
      },
    );
  };

  const handleDelete = (notification: AppNotification) => {
    deleteNotification.mutate(notification.id, {
      onSuccess: () => {
        toast.show("success", "Notification supprimée");
        if (items.length === 1 && page > 1) setPage(page - 1);
      },
      onError: (err) => toast.show("error", getErrorMessage(err)),
    });
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined, {
      onSuccess: (result) => {
        toast.show(
          "success",
          result.updated > 0
            ? `${plural(result.updated, "notification")} marquée${result.updated > 1 ? "s" : ""} comme lue${result.updated > 1 ? "s" : ""}`
            : "Aucune notification non lue",
        );
      },
      onError: (err) => toast.show("error", getErrorMessage(err)),
    });
  };

  const handleClear = () => {
    if (!confirmation) return;
    clearNotifications.mutate(confirmation, {
      onSuccess: (result) => {
        toast.show(
          "success",
          result.deleted > 0
            ? `${plural(result.deleted, "notification")} supprimée${result.deleted > 1 ? "s" : ""}`
            : "Aucune notification à supprimer",
        );
        setConfirmation(null);
        setPage(1);
      },
      onError: (err) => toast.show("error", getErrorMessage(err)),
    });
  };

  const openNotification = (notification: AppNotification) => {
    if (!notification.link) return;
    markAsRead(notification);
    navigate(notification.link);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Toutes vos alertes de pipeline, de sécurité et de déploiement."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-1.5"
            >
              <RefreshCw
                className={cn("h-4 w-4", isFetching && "animate-spin")}
              />
              Rafraîchir
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/settings/notifications")}
            >
              <Settings className="h-4 w-4" />
              Préférences
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Filtrer par statut de lecture"
            >
              {STATUS_TABS.map((tab) => {
                const active = status === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setStatus(tab.key);
                      setPage(1);
                    }}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                      active
                        ? "border-primary-500 bg-primary-600/10 text-primary-600 dark:text-primary-400"
                        : "border-border text-muted hover:bg-slate-100 dark:hover:bg-slate-700/50",
                    )}
                  >
                    {tab.label}
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                        active
                          ? "bg-primary-600/15"
                          : "bg-slate-500/10",
                      )}
                    >
                      {counts[tab.countKey]}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as NotificationKind | "");
                  setPage(1);
                }}
                aria-label="Filtrer par type de notification"
                className="sm:w-48"
              >
                <option value="">Tous les types</option>
                {NOTIFICATION_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <div className="sm:w-64">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Titre ou message…"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={globalUnread === 0 || markAllRead.isPending}
              loading={markAllRead.isPending}
            >
              <CheckCheck className="h-4 w-4" />
              Tout marquer lu
              {globalUnread > 0 && (
                <span className="rounded-full bg-primary-600/10 px-1.5 py-0.5 text-[10px] tabular-nums text-primary-600 dark:text-primary-400">
                  {globalUnread}
                </span>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmation("read")}
              disabled={globalCounts.read === 0 || clearNotifications.isPending}
            >
              <MailOpen className="h-4 w-4" />
              Supprimer les lues
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmation("all")}
              disabled={globalCounts.all === 0 || clearNotifications.isPending}
            >
              <Trash2 className="h-4 w-4" />
              Tout supprimer
            </Button>
            <span className="ml-auto text-xs text-muted">
              {total} résultat{total > 1 ? "s" : ""}
              {hasFilters ? " (filtré)" : ""}
            </span>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex items-start gap-4 px-5 py-4">
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!isLoading && isError && (
        <ErrorState
          title="Impossible de charger les notifications"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={BellOff}
              title={
                hasFilters
                  ? "Aucune notification correspondante"
                  : "Aucune notification"
              }
              description={
                hasFilters
                  ? "Essayez de modifier vos filtres ou votre recherche."
                  : "Les alertes de pipelines, de sécurité et de déploiement apparaîtront ici."
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" onClick={resetFilters}>
                    Réinitialiser les filtres
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 text-xs text-muted">
              <span className="tabular-nums">
                {items.length} sur {total} notification{total > 1 ? "s" : ""}
                {hasFilters ? " (filtré)" : ""}
              </span>
              <span>Actualisation toutes les 30 s</span>
            </div>

            <div className="divide-y divide-border">
              {items.map((notification) => {
                const meta = NOTIFICATION_KIND_META[notification.kind];
                const Icon = meta.icon;
                const unread = !notification.readAt;

                return (
                  <div
                    key={notification.id}
                    onClick={(event) => {
                      if (!notification.link) return;
                      if (
                        (event.target as HTMLElement).closest("a,button")
                      ) {
                        return;
                      }
                      openNotification(notification);
                    }}
                    className={cn(
                      "group flex items-start gap-4 px-5 py-4 transition-colors",
                      unread && "bg-primary-600/5",
                      notification.link &&
                        "cursor-pointer hover:bg-slate-100/70 dark:hover:bg-slate-700/30",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                        meta.iconClassName,
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        {unread && (
                          <span
                            className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary-500"
                            aria-label="Non lue"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          {notification.link ? (
                            <Link
                              to={notification.link}
                              onClick={() => markAsRead(notification)}
                              className={cn(
                                "block text-sm hover:text-primary-600 dark:hover:text-primary-400",
                                unread && "font-medium",
                              )}
                            >
                              {notification.title}
                            </Link>
                          ) : (
                            <p
                              className={cn(
                                "text-sm",
                                unread && "font-medium",
                              )}
                            >
                              {notification.title}
                            </p>
                          )}

                          {notification.message && (
                            <p className="mt-1 text-sm text-muted">
                              {notification.message}
                            </p>
                          )}

                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                            <span>{timeAgo(notification.createdAt)}</span>
                            <span aria-hidden="true">·</span>
                            <span className={cn("font-medium", meta.textClassName)}>
                              {meta.label}
                            </span>
                            {unread && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="rounded-full bg-primary-600/10 px-2 py-0.5 text-[10px] font-medium text-primary-600 dark:text-primary-400">
                                  Non lue
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleRead(notification);
                        }}
                        disabled={
                          markRead.isPending || deleteNotification.isPending
                        }
                        title={
                          unread
                            ? "Marquer comme lue"
                            : "Marquer comme non lue"
                        }
                        aria-label={
                          unread
                            ? `Marquer comme lue : ${notification.title}`
                            : `Marquer comme non lue : ${notification.title}`
                        }
                        className="rounded-md p-2 text-muted hover:bg-slate-200/70 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-700/60 dark:hover:text-slate-200"
                      >
                        {unread ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Mail className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDelete(notification);
                        }}
                        disabled={
                          markRead.isPending || deleteNotification.isPending
                        }
                        title="Supprimer"
                        aria-label={`Supprimer la notification : ${notification.title}`}
                        className="rounded-md p-2 text-muted hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && (
        <Pagination page={page} totalPages={totalPages} onPage={setPage} />
      )}

      <ConfirmDialog
        open={confirmation !== null}
        title={
          confirmation === "read"
            ? "Supprimer les notifications lues ?"
            : "Supprimer toutes les notifications ?"
        }
        description={
          confirmation === "read"
            ? "Toutes les notifications déjà lues seront retirées de votre boîte. Les pipelines et rapports ne sont pas affectés."
            : "Toutes vos notifications seront retirées de votre boîte. Les pipelines et rapports ne sont pas affectés."
        }
        confirmLabel="Supprimer"
        danger
        loading={clearNotifications.isPending}
        onConfirm={handleClear}
        onCancel={() => setConfirmation(null)}
      />
    </div>
  );
}
