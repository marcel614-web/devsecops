import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, FolderGit2, Trash2, GitBranch, Rocket, ArrowUpRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SearchInput } from "@/components/ui/SearchInput";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import { useDeleteProject, useProjects } from "@/hooks/useProjects";
import { CreateProjectModal } from "./CreateProjectModal";
import { timeAgo, cn } from "@/lib/utils";
import { getErrorMessage } from "@/services/api";

const TECH: Record<string, { label: string; bar: string; chip: string }> = {
  NODEJS: { label: "Node.js", bar: "bg-emerald-500", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  PHP: { label: "PHP", bar: "bg-indigo-500", chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  PYTHON: { label: "Python", bar: "bg-amber-500", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  UNKNOWN: { label: "Inconnu", bar: "bg-slate-400", chip: "bg-slate-500/10 text-muted" },
};

export function ProjectsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get("page") ?? 1);
  const search = searchParams.get("search") ?? "";

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const toast = useToast();

  const { data, isLoading, isError, error, refetch } = useProjects({
    page,
    pageSize: 12,
    search: search || undefined,
  });
  const deleteMutation = useDeleteProject();

  const updateParams = (updates: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    setSearchParams(next);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.show("success", `Projet "${deleteTarget.name}" supprimé`);
      setDeleteTarget(null);
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projets"
        description="Pipelines, scans de sécurité et déploiements de vos dépôts"
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Nouveau projet
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-md">
          <SearchInput
            value={search}
            onChange={(v) => updateParams({ search: v, page: 1 })}
            placeholder="Rechercher par nom ou dépôt…"
          />
        </div>
        {data && (
          <p className="text-sm text-muted tabular-nums" aria-live="polite">
            {data.total} projet{data.total > 1 ? "s" : ""}
            {search && ` pour « ${search} »`}
          </p>
        )}
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les projets"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {data && data.items.length === 0 && !search && (
        <EmptyState
          icon={FolderGit2}
          title="Aucun projet pour le moment"
          description="Connectez un dépôt pour lancer vos premiers scans et déploiements."
          action={
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" /> Créer un projet
            </Button>
          }
        />
      )}

      {data && data.items.length === 0 && search && (
        <EmptyState
          title="Aucun résultat"
          description={`Aucun projet ne correspond à « ${search} ». Essayez un autre nom de projet ou de dépôt.`}
          action={<Button variant="secondary" onClick={() => updateParams({ search: "", page: 1 })}>Effacer la recherche</Button>}
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.items.map((p) => {
              const t = TECH[p.technology] ?? TECH.UNKNOWN;
              return (
                <li key={p.id}>
                  <Card className="group relative h-full overflow-hidden rounded-xl border border-border bg-surface transition hover:border-primary-500/50 hover:shadow-md focus-within:ring-2 focus-within:ring-primary-500/40">
                    <span className={cn("absolute inset-y-0 left-0 w-1", t.bar)} aria-hidden />
                    <div className="flex h-full flex-col p-5 pl-6">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          to={`/projects/${p.id}`}
                          className="min-w-0 flex-1 outline-none after:absolute after:inset-0 after:content-['']"
                        >
                          <h3 className="truncate text-base font-semibold group-hover:text-primary-600 dark:group-hover:text-primary-400">
                            {p.name}
                          </h3>
                          <p className="mt-0.5 truncate font-mono text-xs text-muted">{p.repoFullName}</p>
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                          className="relative z-10 shrink-0 rounded-md p-1.5 text-muted opacity-100 transition hover:bg-red-500/10 hover:text-red-500 focus-visible:ring-2 focus-visible:ring-red-500 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                          title="Supprimer le projet"
                          aria-label={`Supprimer ${p.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <p className="mb-4 mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-muted">
                        {p.description || "Aucune description"}
                      </p>

                      <div className="mb-4 flex flex-wrap gap-2 text-[11px] font-medium">
                        <span className={cn("rounded-md px-2 py-1", t.chip)}>{t.label}</span>
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-200/70 px-2 py-1 text-muted dark:bg-slate-700/60">
                          <GitBranch className="h-3 w-3" /> {p.defaultBranch}
                        </span>
                        {p.deploymentEnabled && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-600 dark:text-emerald-400">
                            <Rocket className="h-3 w-3" /> Déploiement actif
                          </span>
                        )}
                      </div>

                      <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted">
                        <span>Créé {timeAgo(p.createdAt)}</span>
                        <span className="inline-flex items-center gap-1 font-medium text-primary-500">
                          Ouvrir <ArrowUpRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>

          <div className="pt-2">
            <Pagination page={data.page} totalPages={data.totalPages} onPage={(p) => updateParams({ page: p })} />
          </div>
        </>
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(name) => {
          setCreateOpen(false);
          toast.show("success", `Projet "${name}" créé`);
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Supprimer ce projet ?"
        description={
          deleteTarget
            ? `« ${deleteTarget.name} » sera définitivement supprimé, avec ses pipelines, scans et rapports.`
            : ""
        }
        confirmLabel="Supprimer"
        danger
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
