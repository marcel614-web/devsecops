import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, PlayCircle, RotateCcw, Trash2, GitBranch, RefreshCw } from "lucide-react";
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
  const [deleteTarget, setDeleteTarget] = useState<{ pipelineId: string; commitSha: string } | null>(null);

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
    mutationFn: (pipelineId: string) => pipelineService.delete(projectId, pipelineId),
    onSuccess: () => {
      toast.show("success", "Pipeline supprimé");
      qc.invalidateQueries({ queryKey: ["project-pipelines", projectId] });
      qc.invalidateQueries({ queryKey: ["global-pipelines"] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const rerunMutation = useMutation({
    mutationFn: (pipelineId: string) => pipelineService.rerun(projectId, pipelineId),
    onSuccess: (p) => {
      toast.show("success", `Pipeline relancé : ${p.id.slice(0, 8)}`);
      qc.invalidateQueries({ queryKey: ["project-pipelines", projectId] });
      qc.invalidateQueries({ queryKey: ["global-pipelines"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "summary"] });
      navigate(`/projects/${projectId}/pipelines/${p.id}`);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const resumeMutation = useMutation({
    mutationFn: (t: { pipelineId: string; stepName?: string }) =>
      pipelineService.resume(projectId, t.pipelineId),
    onSuccess: (p, t) => {
      toast.show(
        "success",
        t.stepName
          ? `Pipeline repris à l'étape « ${t.stepName} »`
          : `Pipeline repris : ${p.id.slice(0, 8)}`,
      );
      qc.invalidateQueries({ queryKey: ["project-pipelines", projectId] });
      qc.invalidateQueries({ queryKey: ["global-pipelines"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "summary"] });
      navigate(`/projects/${projectId}/pipelines/${p.id}`);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="tabular-nums">{data ? `${data.total} pipeline${data.total > 1 ? "s" : ""}` : "Chargement…"}</span>
            <span className="inline-flex items-center gap-1 text-xs" title="Actualisation automatique toutes les 5 s">
              <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin text-primary-500" : ""}`} />
              {isFetching ? "Actualisation" : "Auto"}
            </span>
          </div>
          <Button size="sm" onClick={() => runMutation.mutate()} loading={runMutation.isPending} className="gap-1.5">
            <Play className="h-3.5 w-3.5" /> Lancer un pipeline
          </Button>
        </div>

        {isLoading && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11" />)}
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
            description="Lancez un pipeline pour analyser le code et voir les résultats ici."
            action={<Button onClick={() => runMutation.mutate()} loading={runMutation.isPending}><Play className="h-4 w-4" /> Lancer un pipeline</Button>}
          />
        )}

        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-slate-50/60 text-xs text-muted dark:bg-slate-800/30">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Commit</th>
                  <th className="px-4 py-2.5 text-left font-medium">Branche</th>
                  <th className="px-4 py-2.5 text-left font-medium">Statut</th>
                  <th className="px-4 py-2.5 text-right font-medium">Durée</th>
                  <th className="px-4 py-2.5 text-right font-medium">Lancé</th>
                  <th className="w-12 px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a,button")) return;
                      navigate(`/projects/${projectId}/pipelines/${p.id}`);
                    }}
                  >
                    <td className="px-4 py-3">
                      <Link to={`/projects/${projectId}/pipelines/${p.id}`} className="rounded bg-slate-200/60 px-1.5 py-0.5 font-mono text-xs text-primary-600 hover:underline dark:bg-slate-700/60 dark:text-primary-400">
                        {p.commitSha.slice(0, 7)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-muted">
                        <GitBranch className="h-3.5 w-3.5" /> {p.branch}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{formatDuration(p.durationMs)}</td>
                    <td className="px-4 py-3 text-right text-muted">{timeAgo(p.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {p.steps?.[0] && p.status !== "QUEUED" && p.status !== "RUNNING" && (
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-muted hover:bg-primary-500/10 hover:text-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
                            title={`Reprendre à l'étape « ${p.steps[0].name} »`}
                            aria-label={`Reprendre le pipeline ${p.commitSha.slice(0, 7)} à l'étape ${p.steps[0].name}`}
                            disabled={resumeMutation.isPending && resumeMutation.variables?.pipelineId === p.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              resumeMutation.mutate({ pipelineId: p.id, stepName: p.steps?.[0]?.name });
                            }}
                          >
                            <PlayCircle className={`h-4 w-4 ${resumeMutation.isPending && resumeMutation.variables?.pipelineId === p.id ? "animate-spin" : ""}`} />
                          </button>
                        )}
                        {(p.status === "FAILED" || p.status === "SECURITY_BLOCKED") && (
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-muted hover:bg-primary-500/10 hover:text-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Tout relancer depuis le début"
                            aria-label={`Relancer le pipeline ${p.commitSha.slice(0, 7)} depuis le début`}
                            disabled={rerunMutation.isPending && rerunMutation.variables === p.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              rerunMutation.mutate(p.id);
                            }}
                          >
                            <RotateCcw className={`h-4 w-4 ${rerunMutation.isPending && rerunMutation.variables === p.id ? "animate-spin" : ""}`} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-muted hover:bg-red-500/10 hover:text-red-500 focus-visible:ring-2 focus-visible:ring-red-500"
                          title="Supprimer ce pipeline"
                          aria-label={`Supprimer le pipeline ${p.commitSha.slice(0, 7)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({ pipelineId: p.id, commitSha: p.commitSha });
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
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
        description={deleteTarget ? `Le pipeline ${deleteTarget.commitSha.slice(0, 7)} et ses données seront définitivement supprimés.` : ""}
        confirmLabel="Supprimer"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.pipelineId)}
        onCancel={() => setDeleteTarget(null)}
      />
    </Card>
  );
}
