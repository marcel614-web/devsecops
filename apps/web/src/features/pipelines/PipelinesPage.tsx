// apps/web/src/features/pipelines/PipelinesPage.tsx
import { useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranch, RefreshCw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import { projectService } from "@/services/project.service";
import { pipelineService } from "@/services/pipeline.service";
import { getErrorMessage } from "@/services/api";
import { formatDuration, timeAgo } from "@/lib/utils";

export function PipelinesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [deleteTarget, setDeleteTarget] = useState<{
    projectId: string;
    pipelineId: string;
    commitSha: string;
  } | null>(null);
  const projectId = params.get("projectId") ?? "";

  const { data: projects } = useQuery({
    queryKey: ["projects-list"],
    queryFn: () => projectService.list({ pageSize: 100 }),
  });

  const effectiveProjectId = projectId || projects?.items[0]?.id || "";

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["global-pipelines", effectiveProjectId],
    queryFn: () =>
      pipelineService.listByProject(effectiveProjectId, { pageSize: 50 }),
    enabled: !!effectiveProjectId,
    refetchInterval: 10_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (t: { projectId: string; pipelineId: string }) =>
      pipelineService.delete(t.projectId, t.pipelineId),
    onSuccess: () => {
      toast.show("success", "Pipeline supprimé");
      qc.invalidateQueries({ queryKey: ["global-pipelines"] });
      qc.invalidateQueries({ queryKey: ["project-pipelines"] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  return (
    <div>
      <PageHeader
        title="Pipelines"
        description="Suivi des pipelines CI/CD de vos projets"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw
              className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
            />
            Rafraîchir
          </Button>
        }
      />

      {/* Sélecteur de projet */}
      {projects && projects.items.length > 0 && (
        <div className="mb-4 max-w-md">
          <Select
            value={effectiveProjectId}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              next.set("projectId", e.target.value);
              setParams(next);
            }}
          >
            {projects.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.repoFullName}
              </option>
            ))}
          </Select>
        </div>
      )}

      {!effectiveProjectId && (
        <EmptyState
          icon={GitBranch}
          title="Aucun projet"
          description="Crée d'abord un projet pour lancer des pipelines."
        />
      )}

      {isLoading && (
        <Card>
          <CardContent className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </CardContent>
        </Card>
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
          icon={GitBranch}
          title="Aucun pipeline"
          description="Lance un pipeline depuis la page du projet."
        />
      )}

      {data && data.items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <p className="text-sm text-muted">
                {data.total} pipeline(s)
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted border-b border-border">
                  <tr>
                    <th className="text-left py-2 px-4 font-medium">Commit</th>
                    <th className="text-left py-2 px-4 font-medium">Branche</th>
                    <th className="text-left py-2 px-4 font-medium">Auteur</th>
                    <th className="text-left py-2 px-4 font-medium">Trigger</th>
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
                        navigate(`/projects/${effectiveProjectId}/pipelines/${p.id}`);
                      }}
                    >
                      <td className="py-2.5 px-4">
                        <Link
                          to={`/projects/${effectiveProjectId}/pipelines/${p.id}`}
                          className="font-mono text-xs text-primary-500 hover:underline"
                        >
                          {p.commitSha.slice(0, 10)}
                        </Link>
                      </td>
                      <td className="py-2.5 px-4">{p.branch}</td>
                      <td className="py-2.5 px-4 font-mono text-xs">
                        {p.author.slice(0, 12)}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-muted">
                        {p.trigger}
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="py-2.5 px-4 text-right text-muted">
                        {formatDuration(p.durationMs)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-muted">
                        {timeAgo(p.createdAt)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          className="text-muted hover:text-red-500 p-1"
                          title="Supprimer ce pipeline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({
                              projectId: effectiveProjectId,
                              pipelineId: p.id,
                              commitSha: p.commitSha,
                            });
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
          </CardContent>
        </Card>
      )}
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
          deleteMutation.mutate(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}