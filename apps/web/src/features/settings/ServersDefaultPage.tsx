import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ExternalLink,
  Server,
  ServerOff,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/feedback/Toast";
import { SettingsPageHeader } from "./SettingsPageHeader";
import { serverService } from "@/services/server.service";
import { cn, timeAgo } from "@/lib/utils";
import type { DeploymentServer } from "@/types/api";

const KEY = "default-server-id";

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  failed: "bg-red-500/15 text-red-600 dark:text-red-300",
  unknown: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};

const STATUS_LABELS: Record<string, string> = {
  ok: "Opérationnel",
  failed: "En échec",
  unknown: "Non vérifié",
};

function serverStatus(server: DeploymentServer) {
  const status = server.status || "unknown";
  return {
    label: STATUS_LABELS[status] ?? status,
    className: STATUS_STYLES[status] ?? STATUS_STYLES.unknown,
  };
}

export function ServersDefaultPage() {
  const toast = useToast();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["servers", "default-selection"],
    queryFn: () => serverService.list({ pageSize: 100 }),
  });

  const [selected, setSelected] = useState<string>(
    () => localStorage.getItem(KEY) ?? "",
  );
  const [saved, setSaved] = useState<string>(
    () => localStorage.getItem(KEY) ?? "",
  );

  const items = data?.items ?? [];
  const dirty = selected !== saved;
  const selectedServer = items.find((server) => server.id === selected);

  const save = () => {
    localStorage.setItem(KEY, selected);
    setSaved(selected);
    toast.show("success", "Serveur par défaut enregistré");
  };

  const clear = () => {
    localStorage.removeItem(KEY);
    setSelected("");
    setSaved("");
    toast.show("info", "Serveur par défaut retiré");
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Serveur par défaut"
        description="Conservez votre serveur de déploiement favori"
        actions={
          <Link
            to="/servers"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <Server className="h-4 w-4" />
            Gérer les serveurs
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        }
      />

      {isLoading && (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les serveurs"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={ServerOff}
          title="Aucun serveur de déploiement"
          description="Ajoutez d'abord un serveur pour pouvoir définir un serveur par défaut."
          action={
            <Link
              to="/servers"
              className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              <Server className="h-4 w-4" />
              Configurer un serveur
            </Link>
          }
        />
      )}

      {!isLoading && !isError && items.length > 0 && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((server) => {
              const active = selected === server.id;
              const status = serverStatus(server);
              return (
                <button
                  key={server.id}
                  type="button"
                  onClick={() => setSelected(server.id)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-xl border bg-surface p-4 text-left transition-colors",
                    active
                      ? "border-primary-500 ring-2 ring-primary-500/20"
                      : "border-border hover:border-primary-500/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                          active
                            ? "bg-primary-600 text-white"
                            : "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
                        )}
                      >
                        <Server className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {server.name}
                        </p>
                        <p className="truncate font-mono text-xs text-muted">
                          {server.host}:{server.sshPort}
                        </p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        active
                          ? "border-primary-600 bg-primary-600 text-white"
                          : "border-border text-transparent",
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={cn(
                        "inline-flex items-center rounded px-2 py-0.5 font-medium",
                        status.className,
                      )}
                    >
                      {status.label}
                    </span>
                    <span className="text-muted">
                      Dernier contrôle {timeAgo(server.lastCheckedAt)}
                    </span>
                    {server._count?.projects !== undefined && (
                      <span className="text-muted">
                        · {server._count.projects} projet
                        {server._count.projects > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <Card>
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {selectedServer
                    ? `Serveur sélectionné : ${selectedServer.name}`
                    : "Aucun serveur sélectionné"}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {dirty
                    ? "Modification non enregistrée."
                    : "Cette préférence est enregistrée localement dans votre navigateur."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {saved && (
                  <Button variant="outline" onClick={clear}>
                    <Trash2 className="h-4 w-4" />
                    Retirer
                  </Button>
                )}
                <Button onClick={save} disabled={!dirty}>
                  Enregistrer
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
