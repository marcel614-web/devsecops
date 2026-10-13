// apps/web/src/features/projects/ProjectsPage.tsx
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, FolderGit2, MoreVertical, Trash2, ExternalLink } from "lucide-react";
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
    <div>
      <PageHeader
        title="Projets"
        description="Gestion de vos projets DevSecOps"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> Nouveau projet
          </Button>
        }
      />

      <div className="mb-4 max-w-md">
        <SearchInput
          value={search}
          onChange={(v) => updateParams({ search: v, page: 1 })}
          placeholder="Rechercher un projet…"
        />
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.items.map((p) => (
              <Card key={p.id} className="p-5 flex flex-col hover:border-primary-500/50 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <Link to={`/projects/${p.id}`} className="min-w-0 flex-1">
                    <h3 className="font-semibold text-base truncate">{p.name}</h3>
                    <p className="text-xs text-muted font-mono truncate mt-0.5">{p.repoFullName}</p>
                  </Link>
                  <button
                    onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                    className="text-muted hover:text-red-500 shrink-0 p-1"
                    title="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-sm text-muted line-clamp-2 mb-3 min-h-[2.5rem]">
                  {p.description ?? "Pas de description"}
                </p>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  <span className="text-[11px] px-2 py-0.5 rounded bg-primary-600/15 text-primary-600 dark:text-primary-500 font-medium">
                    {p.technology}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-muted">
                    {p.defaultBranch}
                  </span>
                  {p.deploymentEnabled && (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-500">
                      Déploiement actif
                    </span>
                  )}
                </div>

                <div className="mt-auto flex items-center justify-between text-xs text-muted">
                  <span>Créé {timeAgo(p.createdAt)}</span>
                  <Link
                    to={`/projects/${p.id}`}
                    className="text-primary-500 hover:underline flex items-center gap-1"
                  >
                    Ouvrir <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </Card>
            ))}
          </div>

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onPage={(p) => updateParams({ page: p })}
          />
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