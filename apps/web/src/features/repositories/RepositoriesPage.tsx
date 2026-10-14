// apps/web/src/features/repositories/RepositoriesPage.tsx
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Github,
  ExternalLink,
  Lock,
  Globe,
  RefreshCw,
  Trash2,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Link2,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/feedback/Toast";
import {
  useGithubBranches,
  useGithubInstallations,
  useGithubRepositories,
  useRevokeInstallation,
  useSyncInstallation,
} from "@/hooks/useGithub";
import { githubService } from "@/services/github.service";
import { useProjects } from "@/hooks/useProjects";
import { getErrorMessage } from "@/services/api";
import { timeAgo } from "@/lib/utils";
import type { GitHubRepository } from "@/services/github.service";

export function RepositoriesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState<"" | "public" | "private">("");
  const [selectedInstallationId, setSelectedInstallationId] = useState<string>("");
  const [page, setPage] = useState(1);

  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [associateRepo, setAssociateRepo] = useState<GitHubRepository | null>(null);

  const { data: installations, isLoading: installsLoading, refetch: refetchInstalls } =
    useGithubInstallations();

  const { data: reposData, isLoading: reposLoading, isError, error, refetch: refetchRepos } =
    useGithubRepositories({
      installationId: selectedInstallationId || undefined,
      search: search || undefined,
      private: visibility === "private" ? true : visibility === "public" ? false : undefined,
      page,
    });

  const revokeMutation = useRevokeInstallation();
  const syncMutation = useSyncInstallation();

  // Traitement du retour d'installation GitHub
  useEffect(() => {
    const gh = searchParams.get("github");
    const reason = searchParams.get("reason");
    const action = searchParams.get("action");

    if (gh === "success") {
      toast.show(
        "success",
        action === "updated"
          ? "Installation GitHub mise à jour"
          : "GitHub App installée avec succès",
      );
      refetchInstalls();
      refetchRepos();
      const next = new URLSearchParams(searchParams);
      next.delete("github");
      next.delete("reason");
      next.delete("action");
      next.delete("installation_id");
      setSearchParams(next, { replace: true });
    } else if (gh === "error") {
      toast.show("error", `Erreur d'installation GitHub : ${reason ?? "inconnue"}`);
      const next = new URLSearchParams(searchParams);
      next.delete("github");
      next.delete("reason");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, toast, refetchInstalls, refetchRepos]);

  const handleInstall = async () => {
    try {
      const url = await githubService.startInstall();
      window.location.href = url;
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    }
  };

  const handleRevoke = async () => {
    if (!confirmRevokeId) return;
    try {
      await revokeMutation.mutateAsync(confirmRevokeId);
      toast.show("success", "Installation révoquée");
      setConfirmRevokeId(null);
    } catch (err) {
      toast.show("error", getErrorMessage(err));
      setConfirmRevokeId(null);
    }
  };

  const handleSync = async (installationId: string) => {
    try {
      await syncMutation.mutateAsync(installationId);
      toast.show("success", "Synchronisation lancée");
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    }
  };

  const hasInstallations = installations && installations.length > 0;

  return (
    <div>
      <PageHeader
        title="Repositories GitHub"
        description="Dépôts accessibles via la GitHub App installée"
        actions={
          <Button onClick={handleInstall}>
            <Plus className="w-4 h-4" />
            {hasInstallations ? "Ajouter une installation" : "Installer la GitHub App"}
          </Button>
        }
      />

      {/* --------------------------------------------------
          Bloc d'information / installation
      -------------------------------------------------- */}
      {installsLoading ? (
        <Skeleton className="h-24 mb-6" />
      ) : !hasInstallations ? (
        <Card className="mb-6 border-primary-500/40 bg-primary-600/5">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="w-10 h-10 rounded-full bg-primary-600/15 flex items-center justify-center shrink-0">
              <Github className="w-5 h-5 text-primary-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                Installe la GitHub App sur ton compte ou ton organisation
              </p>
              <p className="text-xs text-muted mt-0.5">
                Tu choisiras toi-même à quels dépôts (publics ou privés) donner accès.
                Aucun mot de passe n'est demandé.
              </p>
            </div>
            <Button onClick={handleInstall}>
              <Github className="w-4 h-4" /> Installer
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-6">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <p className="text-sm font-medium">
              Installations GitHub ({installations.length})
            </p>
          </div>
          <div className="divide-y divide-border/60">
            {installations.map((inst) => (
              <div
                key={inst.id}
                className="flex items-center gap-4 px-5 py-3"
              >
                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                  <Github className="w-4 h-4" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">
                      {inst.accountLogin}
                    </p>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-muted">
                      {inst.accountType === "Organization" ? "Organisation" : "Compte perso"}
                    </span>
                    {inst.suspendedAt && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-500">
                        Suspendue
                      </span>
                    )}
                    <span className="text-xs text-muted">
                      {inst._count?.repositories ?? 0} repo(s)
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    Installée {timeAgo(inst.createdAt)}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSync(inst.installationId)}
                    disabled={syncMutation.isPending}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmRevokeId(inst.installationId)}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* --------------------------------------------------
          Filtres
      -------------------------------------------------- */}
      {hasInstallations && (
        <Card className="mb-4">
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 py-4">
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Rechercher un repository…"
            />
            <Select
              value={visibility}
              onChange={(e) => { setVisibility(e.target.value as "" | "public" | "private"); setPage(1); }}
            >
              <option value="">Tous</option>
              <option value="public">Publics</option>
              <option value="private">Privés</option>
            </Select>
            <Select
              value={selectedInstallationId}
              onChange={(e) => { setSelectedInstallationId(e.target.value); setPage(1); }}
            >
              <option value="">Toutes les installations</option>
              {installations?.map((i) => (
                <option key={i.id} value={i.installationId}>
                  {i.accountLogin}
                </option>
              ))}
            </Select>
          </CardContent>
        </Card>
      )}

      {/* --------------------------------------------------
          Liste des repos
      -------------------------------------------------- */}
      {reposLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les repositories"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetchRepos()}
        />
      )}

      {reposData && reposData.items.length === 0 && hasInstallations && (
        <EmptyState
          icon={Github}
          title="Aucun repository"
          description="Aucun dépôt ne correspond à ces filtres. Vérifie que l'installation a accès à des dépôts."
        />
      )}

      {reposData && reposData.items.length > 0 && (
        <>
          <div className="space-y-3">
            {reposData.items.map((repo) => (
              <Card key={repo.id}>
                <CardContent className="flex flex-col md:flex-row md:items-center gap-4 py-4">
                  <div className="w-10 h-10 rounded-md bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                    {repo.private ? (
                      <Lock className="w-5 h-5 text-amber-500" />
                    ) : (
                      <Globe className="w-5 h-5 text-muted" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm truncate">{repo.fullName}</h3>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-muted">
                        {repo.private ? "Privé" : "Public"}
                      </span>
                      {repo.language && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-600/15 text-primary-600 dark:text-primary-500">
                          {repo.language}
                        </span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-muted">
                        {repo.installation.accountLogin}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-1 truncate">
                      {repo.description ?? "Pas de description"}
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      Branche par défaut : <span className="font-mono">{repo.defaultBranch}</span>
                      {repo._count?.projects ? ` · ${repo._count.projects} projet(s) lié(s)` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => setAssociateRepo(repo)}
                    >
                      <Link2 className="w-3.5 h-3.5" /> Associer
                    </Button>
                    <a
                      href={repo.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors inline-flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> GitHub
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Pagination
            page={reposData.page}
            totalPages={reposData.totalPages}
            onPage={setPage}
          />
        </>
      )}

      {/* Modales */}
      <ConfirmDialog
        open={!!confirmRevokeId}
        title="Révoquer cette installation ?"
        description="GitHub cessera d'envoyer des événements. Les projets liés à ces dépôts seront détachés."
        confirmLabel="Révoquer"
        danger
        loading={revokeMutation.isPending}
        onConfirm={handleRevoke}
        onCancel={() => setConfirmRevokeId(null)}
      />

      {associateRepo && (
        <AssociateRepositoryModal
          repository={associateRepo}
          onClose={() => setAssociateRepo(null)}
          onSuccess={() => {
            setAssociateRepo(null);
            refetchRepos();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// MODALE D'ASSOCIATION
// ============================================================
function AssociateRepositoryModal({
  repository,
  onClose,
  onSuccess,
}: {
  repository: GitHubRepository;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [projectId, setProjectId] = useState("");
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { data: projects } = useProjects({ pageSize: 100 });
  const { data: branches, isLoading: branchesLoading } = useGithubBranches(repository.id);

  useEffect(() => {
    if (repository && !branch) {
      setBranch(repository.defaultBranch);
    }
  }, [repository, branch]);

  const handleSubmit = async () => {
    if (!projectId || !branch) {
      setError("Sélectionne un projet et une branche");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await (await import("@/services/project.service")).projectService.associateRepository(
        projectId,
        repository.id,
        branch,
      );
      toast.show("success", `Repository associé à un projet`);
      onSuccess();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-lg w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-lg">Associer à un projet</h2>
          <button onClick={onClose} className="text-muted hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-3 rounded bg-slate-100 dark:bg-slate-800">
            <p className="text-xs text-muted">Repository</p>
            <p className="text-sm font-mono truncate">{repository.fullName}</p>
          </div>

          <div>
            <label className="block text-sm mb-1">Projet *</label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Sélectionner un projet —</option>
              {projects?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-sm mb-1">Branche surveillée *</label>
            <Select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={branchesLoading}
            >
              {branchesLoading && <option>Chargement…</option>}
              {branches?.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} {b.protected ? "(protégée)" : ""}
                </option>
              ))}
            </Select>
          </div>

          {error && (
            <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>Annuler</Button>
            <Button onClick={handleSubmit} loading={loading}>
              Associer
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}