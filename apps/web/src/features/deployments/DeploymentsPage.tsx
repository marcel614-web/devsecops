import { useState } from "react";
import { ExternalLink, Play, Square, RotateCw, Trash2, Rocket } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import { deploymentService } from "@/services/deployment.service";
import { getErrorMessage } from "@/services/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { timeAgo } from "@/lib/utils";

type DeploymentItem = {
  id: string;
  projectId: string;
  status: string;
  url: string | null;
  imageTag: string | null;
  releaseVersion: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  project?: { id: string; name: string; technology: string };
  server?: { id: string; name: string; host: string };
};

export function DeploymentsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [uninstallTarget, setUninstallTarget] = useState<DeploymentItem | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["deployments"],
    queryFn: () => deploymentService.list(),
    refetchInterval: 10_000,
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => deploymentService.start(id),
    onSuccess: () => {
      toast.show("success", "Application démarrée");
      qc.invalidateQueries({ queryKey: ["deployments"] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => deploymentService.stop(id),
    onSuccess: () => {
      toast.show("success", "Application arrêtée");
      qc.invalidateQueries({ queryKey: ["deployments"] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const restartMutation = useMutation({
    mutationFn: (id: string) => deploymentService.restart(id),
    onSuccess: () => {
      toast.show("success", "Application redémarrée");
      qc.invalidateQueries({ queryKey: ["deployments"] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const uninstallMutation = useMutation({
    mutationFn: (id: string) => deploymentService.uninstall(id),
    onSuccess: () => {
      toast.show("success", "Application désinstallée");
      qc.invalidateQueries({ queryKey: ["deployments"] });
      setUninstallTarget(null);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const items = (data ?? []) as DeploymentItem[];

  return (
    <div>
      <PageHeader
        title="Applications déployées"
        description="Gestion des applications installées sur vos serveurs"
        actions={
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <Rocket className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            Rafraîchir
          </Button>
        }
      />

      {isLoading && (
        <Card>
          <CardContent className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </CardContent>
        </Card>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les déploiements"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          title="Aucune application déployée"
          description="Lance un pipeline avec le déploiement activé pour voir apparaître une application ici."
        />
      )}

      {!isLoading && !isError && items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted border-b border-border">
                  <tr>
                    <th className="text-left py-2 px-4 font-medium">Application</th>
                    <th className="text-left py-2 px-4 font-medium">Serveur</th>
                    <th className="text-left py-2 px-4 font-medium">Statut</th>
                    <th className="text-left py-2 px-4 font-medium">URL</th>
                    <th className="text-right py-2 px-4 font-medium">Date</th>
                    <th className="text-right py-2 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((d) => (
                    <tr key={d.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 px-4">
                        <div className="font-medium">{d.project?.name ?? d.projectId}</div>
                        <div className="text-xs text-muted">{d.imageTag ?? "—"}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        {d.server?.name ?? "—"}
                        <div className="text-xs text-muted">{d.server?.host}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusBadge status={d.status as any} />
                        {d.error && <div className="text-xs text-red-500 mt-1 max-w-xs truncate">{d.error}</div>}
                      </td>
                      <td className="py-2.5 px-4">
                        {d.url ? (
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary-500 hover:underline inline-flex items-center gap-1"
                          >
                            {d.url} <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right text-muted">
                        {timeAgo(d.createdAt)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Démarrer"
                            onClick={() => startMutation.mutate(d.id)}
                            loading={startMutation.isPending}
                          >
                            <Play className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Arrêter"
                            onClick={() => stopMutation.mutate(d.id)}
                            loading={stopMutation.isPending}
                          >
                            <Square className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Redémarrer"
                            onClick={() => restartMutation.mutate(d.id)}
                            loading={restartMutation.isPending}
                          >
                            <RotateCw className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Désinstaller"
                            onClick={() => setUninstallTarget(d)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={!!uninstallTarget}
        title="Désinstaller cette application ?"
        description={
          uninstallTarget
            ? `L'application ${uninstallTarget.project?.name ?? ""} sera arrêtée et ses conteneurs supprimés.`
            : ""
        }
        confirmLabel="Désinstaller"
        danger
        loading={uninstallMutation.isPending}
        onConfirm={() => {
          if (!uninstallTarget) return;
          uninstallMutation.mutate(uninstallTarget.id);
        }}
        onCancel={() => setUninstallTarget(null)}
      />
    </div>
  );
}