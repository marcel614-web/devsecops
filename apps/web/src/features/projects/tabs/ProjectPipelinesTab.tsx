// apps/web/src/features/projects/tabs/ProjectPipelinesTab.tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/feedback/Toast";
import { pipelineService } from "@/services/pipeline.service";
import { formatDuration, timeAgo } from "@/lib/utils";
import { getErrorMessage } from "@/services/api";

export function ProjectPipelinesTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<{
    pipelineId: string;
    commitSha: string;
  } | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["project-pipelines", projectId],
    queryFn: () => pipelineService.listByProject(projectId, { pageSize: 20 }),
    refetchInterval: 5_000,
  });

  const runMutation = useMutation({
    mutationFn: () => pipelineService.run(projectId, {}),
    onSuccess: (p) => {
      toast.show("success", `Pipeline ${p.id.slice(0, 8)} lancé`);
      qc.invalidateQueries({ queryKey: ["project-pipelines", projectId] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (pipelineId: string) =>
      pipelineService.delete(projectId, pipelineId),
    onSuccess: () => {
      toast.show("success", "Pipeline supprimé");
      qc.invalidateQueries({ queryKey: ["project-pipelines", projectId] });
      qc.invalidateQueries({ queryKey: ["global-pipelines"] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <p className="text-sm text-muted">
            {data ? `${data.total} pipeline(s)` : "Chargement…"}
            {isFetching && <span className="ml-2 text-primary-500 text-xs">· actualisation</span>}
          </p>
          <Button size="sm" onClick={() => runMutation.mutate()} loading={runMutation.isPending}>
            <Play className="w-3.5 h-3.5" /> Lancer
          </Button>
        </div>

        {isLoading && (
          <div className="p-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        )}

        {isError && (
          <ErrorState
            title="Impossible de charger les pipelines"
            description={error instanceof Error ? error.message : undefined}
            onRetry={() => refetch()}
          />
        )}

        {data && data.items.length === 0 && (
          <EmptyState
            title="Aucun pipeline"
            description="Lance ton premier pipeline pour voir apparaître les résultats ici."
          />
        )}

        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted border-b border-border">
                <tr>
                  <th className="text-left py-2 px-4 font-medium">Commit</th>
                  <th className="text-left py-2 px-4 font-medium">Branche</th>
                  <th className="text-left py-2 px-4 font-medium">Statut</th>
                  <th className="text-right py-2 px-4 font-medium">Durée</th>
                  <th className="text-right py-2 px-4 font-medium">Date</th>
                  <th className="text-right py-2 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-border/60 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30 cursor-pointer"
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest("a,button")) return;
                      navigate(`/projects/${projectId}/pipelines/${p.id}`);
                    }}
                  >
                    <td className="py-2.5 px-4">
                      <Link
                        to={`/projects/${projectId}/pipelines/${p.id}`}
                        className="font-mono text-xs text-primary-500 hover:underline"
                      >
                        {p.commitSha.slice(0, 10)}
                      </Link>
                    </td>
                    <td className="py-2.5 px-4">{p.branch}</td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="py-2.5 px-4 text-right text-muted">
                      {formatDuration(p.durationMs)}
                    </td>
                    <td className="py-2.5 px-4 text-right text-muted">{timeAgo(p.createdAt)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        className="text-muted hover:text-red-500 p-1"
                        title="Supprimer ce pipeline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ pipelineId: p.id, commitSha: p.commitSha });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!deleteTarget}
        title="Supprimer ce pipeline ?"
        description={
          deleteTarget
            ? `Le pipeline ${deleteTarget.commitSha.slice(0, 10)} et toutes ses données associées seront définitivement supprimés.`
            : ""
        }
        confirmLabel="Supprimer"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.pipelineId);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Card>
  );
}