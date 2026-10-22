// apps/web/src/features/servers/ServersPage.tsx
import { useState } from "react";
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  ShieldCheck,
  Activity,
  Gauge,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { SearchInput } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import {
  useDeleteServer,
  useServers,
  useTestServer,
} from "@/hooks/useServers";
import { CreateServerModal } from "./CreateServerModal";
import { EditServerModal } from "./EditServerModal";
import { ServerTestResultPanel } from "./ServerTestResultPanel";
import { ServerResourcesPanel } from "./ServerResourcesPanel";
import { timeAgo } from "@/lib/utils";
import { getErrorMessage } from "@/services/api";
import { serverService, type ServerResources } from "@/services/server.service";
import type { DeploymentServer } from "@/types/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface TestResultCache {
  [serverId: string]: {
    ssh: { ok: boolean; error?: string; latencyMs?: number };
    docker: { ok: boolean; version?: string; error?: string };
    dockerCompose: { ok: boolean; version?: string; error?: string };
    nginx: { ok: boolean; version?: string; error?: string };
  };
}

export function ServersPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DeploymentServer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResultCache>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resourcesByServer, setResourcesByServer] = useState<
    Record<string, ServerResources>
  >({});
  const [resourcesExpandedId, setResourcesExpandedId] = useState<string | null>(
    null,
  );
  const toast = useToast();

  const { data, isLoading, isError, error, refetch } = useServers({
    search: search || undefined,
    pageSize: 50,
  });

  const qc = useQueryClient();
  const deleteMutation = useDeleteServer();
  const testMutation = useTestServer();
  const cleanupMutation = useMutation({
    mutationFn: (id: string) => serverService.cleanupImages(id),
    onSuccess: (_result, id) => {
      toast.show("success", "Images Docker inutilisées supprimées");
      // Les compteurs Docker affichés ne sont plus à jour.
      setResourcesByServer((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setResourcesExpandedId((current) => (current === id ? null : current));
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const resourcesMutation = useMutation({
    mutationFn: (id: string) => serverService.getResources(id),
    onSuccess: (result, id) => {
      setResourcesByServer((prev) => ({ ...prev, [id]: result }));
      setResourcesExpandedId(id);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

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

  const handleTest = async (id: string, name: string) => {
    setTestingId(id);
    try {
      const response = await testMutation.mutateAsync(id);
      setTestResults((prev) => ({ ...prev, [id]: response.result }));
      setExpandedId(id);

      if (response.status === "ok") {
        toast.show("success", `Serveur "${name}" : connexion OK`);
      } else {
        toast.show(
          "error",
          `Serveur "${name}" : échec de la connexion`,
        );
      }
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    } finally {
      setTestingId(null);
    }
  };

  const handleResources = (id: string) => {
    if (resourcesExpandedId === id) {
      setResourcesExpandedId(null);
      return;
    }
    resourcesMutation.mutate(id);
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
        <EmptyState
          title="Aucun résultat"
          description={`Aucun serveur ne correspond à "${search}".`}
        />
      )}

      {data && data.items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((s) => {
            const isTesting = testingId === s.id;
            const testResult = testResults[s.id];
            const isExpanded = expandedId === s.id;
            const isResourcesExpanded = resourcesExpandedId === s.id;
            const resources = resourcesByServer[s.id];
            const isLoadingResources =
              resourcesMutation.isPending && resourcesMutation.variables === s.id;
            const isStatusOk = s.status === "ok";
            const isStatusFailed = s.status === "failed";

            return (
              <Card key={s.id} className="p-5">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-base truncate">
                      {s.name}
                    </h3>
                    <p className="text-sm text-muted font-mono mt-0.5 truncate">
                      {s.host}:{s.sshPort}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditTarget(s)}
                      className="text-muted hover:text-primary-500 p-1"
                      title="Modifier le serveur"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        setDeleteTarget({ id: s.id, name: s.name })
                      }
                      className="text-muted hover:text-red-500 p-1"
                      title="Supprimer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
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

                {/* Badge de statut */}
                <div className="flex items-center justify-between text-xs mb-3">
                  {isStatusOk && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-500 inline-flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3 h-3" />
                      Connecté
                    </span>
                  )}
                  {isStatusFailed && (
                    <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-500 inline-flex items-center gap-1 font-medium">
                      <XCircle className="w-3 h-3" />
                      Échec
                    </span>
                  )}
                  {!isStatusOk && !isStatusFailed && (
                    <span className="px-2 py-0.5 rounded bg-slate-500/15 text-muted inline-flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      Non testé
                    </span>
                  )}

                  {s.lastCheckedAt && (
                    <span className="text-muted text-[11px]">
                      Testé {timeAgo(s.lastCheckedAt)}
                    </span>
                  )}
                </div>

                {/* Bouton Tester */}
                <div className="flex gap-2">
                  <Button
                    variant={isStatusOk ? "outline" : "primary"}
                    size="sm"
                    onClick={() => handleTest(s.id, s.name)}
                    disabled={isTesting}
                    className="flex-1"
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Test en cours…
                      </>
                    ) : (
                      <>
                        <Activity className="w-3.5 h-3.5" />
                        Tester la connexion
                      </>
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cleanupMutation.mutate(s.id)}
                    disabled={cleanupMutation.isPending}
                    title="Nettoyer les images Docker inutilisées"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>

                  {testResult && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : s.id)
                      }
                      title={isExpanded ? "Masquer" : "Voir les détails"}
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleResources(s.id)}
                  disabled={isLoadingResources}
                  className="mt-2 w-full justify-start text-xs"
                  aria-expanded={isResourcesExpanded}
                  title={
                    isResourcesExpanded
                      ? "Masquer les ressources système"
                      : "Voir les ressources système (CPU, RAM, disque, Docker)"
                  }
                >
                  {isLoadingResources ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Gauge className="w-3.5 h-3.5" />
                  )}
                  {isResourcesExpanded
                    ? "Masquer les ressources"
                    : "Ressources système"}
                  {isResourcesExpanded ? (
                    <ChevronUp className="ml-auto w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="ml-auto w-3.5 h-3.5" />
                  )}
                </Button>

                {/* Panneau de résultat */}
                {testResult && isExpanded && (
                  <ServerTestResultPanel result={testResult} />
                )}

                {resources && isResourcesExpanded && (
                  <ServerResourcesPanel
                    resources={resources}
                    refreshing={isLoadingResources}
                    onRefresh={() => resourcesMutation.mutate(s.id)}
                  />
                )}
              </Card>
            );
          })}
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

      <EditServerModal
        open={!!editTarget}
        server={editTarget}
        onClose={() => setEditTarget(null)}
        onUpdated={(server, name, connectionChanged) => {
          setEditTarget(null);
          setTestResults((prev) => {
            const next = { ...prev };
            delete next[server.id];
            return next;
          });
          setResourcesByServer((prev) => {
            const next = { ...prev };
            delete next[server.id];
            return next;
          });
          if (expandedId === server.id) {
            setExpandedId(null);
          }
          if (resourcesExpandedId === server.id) {
            setResourcesExpandedId(null);
          }
          toast.show("success", `Serveur "${name}" mis à jour`);
          if (connectionChanged) {
            void handleTest(server.id, name);
          }
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