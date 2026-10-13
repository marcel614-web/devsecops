// apps/web/src/features/servers/ServersPage.tsx
import { useState } from "react";
import { Server, Plus, Trash2, ShieldCheck, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { SearchInput } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import { useDeleteServer, useServers } from "@/hooks/useServers";
import { CreateServerModal } from "./CreateServerModal";
import { timeAgo } from "@/lib/utils";
import { getErrorMessage } from "@/services/api";

export function ServersPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const toast = useToast();

  const { data, isLoading, isError, error, refetch } = useServers({
    search: search || undefined,
    pageSize: 50,
  });

  const deleteMutation = useDeleteServer();

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.show("success", `Serveur "${deleteTarget.name}" supprimé`);
      setDeleteTarget(null);
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Serveurs de déploiement"
        description="Serveurs SSH cibles pour vos applications"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> Nouveau serveur
          </Button>
        }
      />

      <div className="mb-4 max-w-md">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Rechercher un serveur…"
        />
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
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

      {data && data.items.length === 0 && !search && (
        <EmptyState
          icon={Server}
          title="Aucun serveur"
          description="Ajoute ton premier serveur de déploiement."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> Ajouter un serveur
            </Button>
          }
        />
      )}

      {data && data.items.length === 0 && search && (
        <EmptyState title="Aucun résultat" description={`Aucun serveur ne correspond à "${search}".`} />
      )}

      {data && data.items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((s) => (
            <Card key={s.id} className="p-5">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-base truncate">{s.name}</h3>
                  <p className="text-sm text-muted font-mono mt-0.5 truncate">
                    {s.host}:{s.sshPort}
                  </p>
                </div>
                <button
                  onClick={() => setDeleteTarget({ id: s.id, name: s.name })}
                  className="text-muted hover:text-red-500 shrink-0 p-1"
                  title="Supprimer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <dl className="space-y-1.5 text-xs mb-3">
                <div className="flex justify-between">
                  <dt className="text-muted">Utilisateur</dt>
                  <dd className="font-mono">{s.username}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Auth</dt>
                  <dd>
                    {s.authType === "SSH_KEY" ? "Clé SSH" : "Mot de passe"}
                    {s.hasPrivateKey && (
                      <ShieldCheck className="w-3 h-3 inline ml-1 text-emerald-500" />
                    )}
                  </dd>
                </div>
                {s._count && (
                  <div className="flex justify-between">
                    <dt className="text-muted">Projets</dt>
                    <dd>{s._count.projects}</dd>
                  </div>
                )}
              </dl>

              <div className="flex items-center justify-between text-xs">
                <span
                  className={`px-2 py-0.5 rounded ${
                    s.status === "ok"
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-500"
                      : s.status === "failed"
                        ? "bg-red-500/15 text-red-600 dark:text-red-500"
                        : "bg-slate-500/15 text-muted"
                  }`}
                >
                  {s.status === "ok"
                    ? "Connexion OK"
                    : s.status === "failed"
                      ? "Connexion échouée"
                      : "Non testé"}
                </span>
                <span className="text-muted">
                  Créé {timeAgo(s.createdAt)}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateServerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(name) => {
          setCreateOpen(false);
          toast.show("success", `Serveur "${name}" créé`);
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Supprimer ce serveur ?"
        description={
          deleteTarget
            ? `Le serveur "${deleteTarget.name}" sera définitivement supprimé. Impossible si des projets y sont associés.`
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