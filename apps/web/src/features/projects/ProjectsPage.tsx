import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, FolderGit2, MoreVertical, Trash2, ExternalLink, Search } from "lucide-react";
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
import { timeAgo } from "@/lib/utils";
import { getErrorMessage } from "@/services/api";

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
        description="Gestion de vos projets DevSecOps"
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Nouveau projet
          </Button>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="max-w-md w-full">
          <SearchInput
            value={search}
            onChange={(v) => updateParams({ search: v, page: 1 })}
            placeholder="Rechercher un projet…"
          />
        </div>
        {data && (
          <p className="text-sm text-muted">
            {data.total} projet{data.total > 1 ? "s" : ""}
          </p>
        )}
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
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
          title="Aucun projet"
          description="Commence par créer ton premier projet DevSecOps."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> Créer un projet
            </Button>
          }
        />
      )}

      {data && data.items.length === 0 && search && (
        <EmptyState
          title="Aucun résultat"
          description={`Aucun projet ne correspond à "${search}".`}
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {data.items.map((p) => (
              <Card
                key={p.id}
                className="group relative rounded-2xl border border-border/70 bg-surface/60 hover:border-primary-500/40 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="p-5 flex flex-col h-full">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <Link to={`/projects/${p.id}`} className="min-w-0 flex-1">
                      <h3 className="font-semibold text-base truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                        {p.name}
                      </h3>
                      <p className="text-xs text-muted font-mono truncate mt-0.5">
                        {p.repoFullName}
                      </p>
                    </Link>
                    <button
                      onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-500 shrink-0 p-1 transition-opacity"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <p className="text-sm text-muted line-clamp-2 mb-4 min-h-[2.5rem]">
                    {p.description ?? "Pas de description"}
                  </p>

                  <div className="flex flex-wrap gap-2 mb-5">
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-primary-600/10 text-primary-600 dark:text-primary-400 font-medium">
                      {p.technology}
                    </span>
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-slate-700/60 text-muted">
                      {p.defaultBranch}
                    </span>
                    {p.deploymentEnabled && (
                      <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        Déploiement actif
                      </span>
                    )}
                  </div>

                  <div className="mt-auto flex items-center justify-between text-xs text-muted">
                    <span>Créé {timeAgo(p.createdAt)}</span>
                    <Link
                      to={`/projects/${p.id}`}
                      className="inline-flex items-center gap-1 text-primary-500 hover:underline font-medium"
                    >
                      Ouvrir <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="pt-4">
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              onPage={(p) => updateParams({ page: p })}
            />
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
            ? `Le projet "${deleteTarget.name}" sera définitivement supprimé, ainsi que tous ses pipelines, scans et rapports.`
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