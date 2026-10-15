// apps/web/src/features/servers/ServersPage.tsx
import { useState } from "react";
import {
  Server,
  Plus,
  Trash2,
  ShieldCheck,
  Activity,
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
import { ServerTestResultPanel } from "./ServerTestResultPanel";
import { timeAgo } from "@/lib/utils";
import { getErrorMessage } from "@/services/api";

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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResultCache>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toast = useToast();

  const { data, isLoading, isError, error, refetch } = useServers({
    search: search || undefined,
    pageSize: 50,
  });

  const deleteMutation = useDeleteServer();
  const testMutation = useTestServer();

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
                  <button
                    onClick={() =>
                      setDeleteTarget({ id: s.id, name: s.name })
                    }
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

                {/* Panneau de résultat */}
                {testResult && isExpanded && (
                  <ServerTestResultPanel result={testResult} />
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