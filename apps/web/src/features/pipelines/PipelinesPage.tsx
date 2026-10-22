import { useMemo, useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranch, RefreshCw, RotateCcw, Trash2, Search, PlayCircle } from "lucide-react";
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
import { formatDuration, timeAgo, cn } from "@/lib/utils";

const FILTERS = [
  { key: "", label: "Tous" },
  { key: "RUNNING", label: "En cours" },
  { key: "SUCCESS", label: "Réussis" },
  { key: "FAILED", label: "Échoués" },
  { key: "SECURITY_BLOCKED", label: "Bloqués" },
];

export function PipelinesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [deleteTarget, setDeleteTarget] = useState<{ projectId: string; pipelineId: string; commitSha: string } | null>(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const projectId = params.get("projectId") ?? "";

  const { data: projects } = useQuery({
    queryKey: ["projects-list"],
    queryFn: () => projectService.list({ pageSize: 100 }),
  });

  const effectiveProjectId = projectId || projects?.items[0]?.id || "";

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["global-pipelines", effectiveProjectId],
    queryFn: () => pipelineService.listByProject(effectiveProjectId, { pageSize: 50 }),
    enabled: !!effectiveProjectId,
    refetchInterval: 10_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (t: { projectId: string; pipelineId: string }) => pipelineService.delete(t.projectId, t.pipelineId),
    onSuccess: () => {
      toast.show("success", "Pipeline supprimé");
      qc.invalidateQueries({ queryKey: ["global-pipelines"] });
      qc.invalidateQueries({ queryKey: ["project-pipelines"] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const rerunMutation = useMutation({
    mutationFn: (t: { projectId: string; pipelineId: string }) =>
      pipelineService.rerun(t.projectId, t.pipelineId),
    onSuccess: (p, t) => {
      toast.show("success", `Pipeline relancé : ${p.id.slice(0, 8)}`);
      qc.invalidateQueries({ queryKey: ["global-pipelines"] });
      qc.invalidateQueries({ queryKey: ["project-pipelines", t.projectId] });
      qc.invalidateQueries({ queryKey: ["dashboard", "summary"] });
      navigate(`/projects/${t.projectId}/pipelines/${p.id}`);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const resumeMutation = useMutation({
    mutationFn: (t: { projectId: string; pipelineId: string; stepName?: string }) =>
      pipelineService.resume(t.projectId, t.pipelineId),
    onSuccess: (p, t) => {
      toast.show(
        "success",
        t.stepName
          ? `Pipeline repris à l'étape « ${t.stepName} »`
          : `Pipeline repris : ${p.id.slice(0, 8)}`,
      );
      qc.invalidateQueries({ queryKey: ["global-pipelines"] });
      qc.invalidateQueries({ queryKey: ["project-pipelines", t.projectId] });
      qc.invalidateQueries({ queryKey: ["dashboard", "summary"] });
      navigate(`/projects/${t.projectId}/pipelines/${p.id}`);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    data?.items.forEach((p) => {
      const s = p.status === "QUEUED" ? "RUNNING" : p.status;
      c[s] = (c[s] ?? 0) + 1;
    });
    return c;
  }, [data]);

  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.items ?? []).filter((p) => {
      const s = p.status === "QUEUED" ? "RUNNING" : p.status;
      return (!status || s === status) &&
        (!term || p.commitSha.toLowerCase().includes(term) || p.branch.toLowerCase().includes(term) || p.author.toLowerCase().includes(term));
    });
  }, [data, status, q]);

  const selectedProject = projects?.items.find((p) => p.id === effectiveProjectId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pipelines"
        description="Exécutions CI/CD, scans de sécurité et déploiements"
        actions={
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /> Rafraîchir
          </Button>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {projects && projects.items.length > 0 && (
          <div className="w-full lg:max-w-sm">
            <Select
              aria-label="Projet"
              value={effectiveProjectId}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.set("projectId", e.target.value);
                setParams(next);
                setStatus("");
              }}
            >
              {projects.items.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.repoFullName}</option>
              ))}
            </Select>
          </div>
        )}
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Commit, branche, auteur…"
            aria-label="Rechercher un pipeline"
            className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
          />
        </div>
      </div>

      {data && data.items.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par statut">
          {FILTERS.map((f) => {
            const n = f.key ? counts[f.key] ?? 0 : data.items.length;
            const on = status === f.key;
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={on}
                onClick={() => setStatus(f.key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary-500",
                  on ? "border-primary-500 bg-primary-600/10 text-primary-600 dark:text-primary-400" : "border-border text-muted hover:bg-slate-100 dark:hover:bg-slate-700/50",
                )}
              >
                {f.label}
                <span className="tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {!effectiveProjectId && (
        <EmptyState icon={GitBranch} title="Aucun projet" description="Créez un projet pour lancer votre premier pipeline." />
      )}

      {isLoading && (
        <Card><CardContent className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</CardContent></Card>
      )}

      {isError && (
        <ErrorState title="Impossible de charger les pipelines" description={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={GitBranch}
          title="Aucun pipeline pour ce projet"
          description="Lancez un pipeline depuis la page du projet."
          action={selectedProject && <Link to={`/projects/${selectedProject.id}?tab=pipelines`}><Button>Ouvrir le projet</Button></Link>}
        />
      )}

      {data && data.items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-3 text-sm text-muted">
              <span className="tabular-nums">{items.length} sur {data.total} pipeline{data.total > 1 ? "s" : ""}</span>
              <span className="text-xs">Actualisation toutes les 10 s</span>
            </div>

            {items.length === 0 ? (
              <EmptyState title="Aucun résultat" description="Modifiez la recherche ou le filtre de statut." action={<Button variant="secondary" onClick={() => { setQ(""); setStatus(""); }}>Réinitialiser</Button>} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-slate-50/60 text-xs text-muted dark:bg-slate-800/30">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium">Commit</th>
                      <th className="px-4 py-2.5 text-left font-medium">Branche</th>
                      <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">Auteur</th>
                      <th className="hidden px-4 py-2.5 text-left font-medium lg:table-cell">Déclencheur</th>
                      <th className="px-4 py-2.5 text-left font-medium">Statut</th>
                      <th className="px-4 py-2.5 text-right font-medium">Durée</th>
                      <th className="px-4 py-2.5 text-right font-medium">Lancé</th>
                      <th className="w-12 px-4 py-2.5"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                      <tr
                        key={p.id}
                        className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a,button")) return;
                          navigate(`/projects/${effectiveProjectId}/pipelines/${p.id}`);
                        }}
                      >
                        <td className="px-4 py-3">
                          <Link to={`/projects/${effectiveProjectId}/pipelines/${p.id}`} className="rounded bg-slate-200/60 px-1.5 py-0.5 font-mono text-xs text-primary-600 hover:underline dark:bg-slate-700/60 dark:text-primary-400">
                            {p.commitSha.slice(0, 7)}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 text-muted"><GitBranch className="h-3.5 w-3.5" />{p.branch}</span>
                        </td>
                        <td className="hidden px-4 py-3 text-xs md:table-cell">{p.author.slice(0, 16)}</td>
                        <td className="hidden px-4 py-3 text-xs text-muted lg:table-cell">{p.trigger}</td>
                        <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted">{formatDuration(p.durationMs)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-muted">{timeAgo(p.createdAt)}</td>
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
                                  resumeMutation.mutate({
                                    projectId: effectiveProjectId,
                                    pipelineId: p.id,
                                    stepName: p.steps?.[0]?.name,
                                  });
                                }}
                              >
                                <PlayCircle className={cn("h-4 w-4", resumeMutation.isPending && resumeMutation.variables?.pipelineId === p.id && "animate-spin")} />
                              </button>
                            )}
                            {(p.status === "FAILED" || p.status === "SECURITY_BLOCKED") && (
                              <button
                                type="button"
                                className="rounded-md p-1.5 text-muted hover:bg-primary-500/10 hover:text-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
                                title="Tout relancer depuis le début"
                                aria-label={`Relancer le pipeline ${p.commitSha.slice(0, 7)} depuis le début`}
                                disabled={rerunMutation.isPending && rerunMutation.variables?.pipelineId === p.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  rerunMutation.mutate({ projectId: effectiveProjectId, pipelineId: p.id });
                                }}
                              >
                                <RotateCcw className={cn("h-4 w-4", rerunMutation.isPending && rerunMutation.variables?.pipelineId === p.id && "animate-spin")} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="rounded-md p-1.5 text-muted hover:bg-red-500/10 hover:text-red-500 focus-visible:ring-2 focus-visible:ring-red-500"
                              title="Supprimer ce pipeline"
                              aria-label={`Supprimer le pipeline ${p.commitSha.slice(0, 7)}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget({ projectId: effectiveProjectId, pipelineId: p.id, commitSha: p.commitSha });
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
        </Card>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Supprimer ce pipeline ?"
        description={deleteTarget ? `Le pipeline ${deleteTarget.commitSha.slice(0, 7)} et ses données seront définitivement supprimés.` : ""}
        confirmLabel="Supprimer"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
