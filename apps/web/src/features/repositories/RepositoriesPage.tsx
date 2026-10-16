import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Github, ExternalLink, Lock, Globe, RefreshCw, Trash2, Plus, Link2, X, GitBranch, Building2, User } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { SearchInput } from "@/components/ui/SearchInput";
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
import { projectService } from "@/services/project.service";
import { useProjects } from "@/hooks/useProjects";
import { getErrorMessage } from "@/services/api";
import { timeAgo, cn } from "@/lib/utils";
import type { GitHubRepository } from "@/services/github.service";

const VISIBILITY = [
  { key: "", label: "Tous" },
  { key: "public", label: "Publics" },
  { key: "private", label: "Privés" },
] as const;

export function RepositoriesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState<"" | "public" | "private">("");
  const [selectedInstallationId, setSelectedInstallationId] = useState("");
  const [page, setPage] = useState(1);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [associateRepo, setAssociateRepo] = useState<GitHubRepository | null>(null);

  const { data: installations, isLoading: installsLoading, refetch: refetchInstalls } = useGithubInstallations();

  const { data: reposData, isLoading: reposLoading, isError, error, refetch: refetchRepos } = useGithubRepositories({
    installationId: selectedInstallationId || undefined,
    search: search || undefined,
    private: visibility === "private" ? true : visibility === "public" ? false : undefined,
    page,
  });

  const revokeMutation = useRevokeInstallation();
  const syncMutation = useSyncInstallation();

  // Retour d'installation GitHub
  useEffect(() => {
    const gh = searchParams.get("github");
    if (!gh) return;
    const reason = searchParams.get("reason");
    const action = searchParams.get("action");
    if (gh === "success") {
      toast.show("success", action === "updated" ? "Installation GitHub mise à jour" : "GitHub App installée avec succès");
      refetchInstalls();
      refetchRepos();
    } else if (gh === "error") {
      toast.show("error", `Erreur d'installation GitHub : ${reason ?? "inconnue"}`);
    }
    const next = new URLSearchParams(searchParams);
    ["github", "reason", "action", "installation_id"].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, toast, refetchInstalls, refetchRepos]);

  const handleInstall = async () => {
    try {
      window.location.href = await githubService.startInstall();
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    }
  };

  const handleRevoke = async () => {
    if (!confirmRevokeId) return;
    try {
      await revokeMutation.mutateAsync(confirmRevokeId);
      toast.show("success", "Installation révoquée");
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    } finally {
      setConfirmRevokeId(null);
    }
  };

  const handleSync = async (installationId: string) => {
    setSyncingId(installationId);
    try {
      await syncMutation.mutateAsync(installationId);
      toast.show("success", "Synchronisation lancée");
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    } finally {
      setSyncingId(null);
    }
  };

  const hasInstallations = !!installations && installations.length > 0;
  const revokeTarget = installations?.find((i) => i.installationId === confirmRevokeId);
  const filtered = !!search || !!visibility || !!selectedInstallationId;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dépôts GitHub"
        description="Dépôts accessibles via la GitHub App installée"
        actions={
          <Button onClick={handleInstall} className="gap-2">
            <Plus className="h-4 w-4" />
            {hasInstallations ? "Ajouter une installation" : "Installer la GitHub App"}
          </Button>
        }
      />

      {/* Installations */}
      {installsLoading ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : !hasInstallations ? (
        <Card className="border-primary-500/40 bg-primary-600/5">
          <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600/15">
              <Github className="h-5 w-5 text-primary-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Connectez GitHub à votre compte ou organisation</p>
              <p className="mt-0.5 text-xs text-muted">
                Vous choisissez les dépôts (publics ou privés) auxquels donner accès. Aucun mot de passe n'est demandé.
              </p>
            </div>
            <Button onClick={handleInstall} className="gap-2"><Github className="h-4 w-4" /> Installer</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="border-b border-border px-5 py-3 text-sm font-medium">
            Installations <span className="ml-1 tabular-nums text-muted">{installations.length}</span>
          </div>
          <ul className="divide-y divide-border/60">
            {installations.map((inst) => {
              const isOrg = inst.accountType === "Organization";
              const syncing = syncingId === inst.installationId;
              return (
                <li key={inst.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700">
                    {isOrg ? <Building2 className="h-4 w-4" /> : <User className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{inst.accountLogin}</p>
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-muted dark:bg-slate-700">
                        {isOrg ? "Organisation" : "Compte personnel"}
                      </span>
                      {inst.suspendedAt && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-500">Suspendue</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {inst._count?.repositories ?? 0} dépôt(s) · installée {timeAgo(inst.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handleSync(inst.installationId)} disabled={syncing} title="Synchroniser" aria-label={`Synchroniser ${inst.accountLogin}`}>
                      <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmRevokeId(inst.installationId)} title="Révoquer" aria-label={`Révoquer ${inst.accountLogin}`}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Filtres */}
      {hasInstallations && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="w-full lg:max-w-sm">
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Rechercher un dépôt…" />
          </div>
          <div role="group" aria-label="Visibilité" className="inline-flex rounded-md border border-border p-0.5">
            {VISIBILITY.map((v) => (
              <button
                key={v.key}
                type="button"
                aria-pressed={visibility === v.key}
                onClick={() => { setVisibility(v.key); setPage(1); }}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary-500",
                  visibility === v.key ? "bg-primary-600 text-white" : "text-muted hover:text-slate-800 dark:hover:text-slate-100",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          {installations.length > 1 && (
            <div className="w-full lg:w-56">
              <Select aria-label="Installation" value={selectedInstallationId} onChange={(e) => { setSelectedInstallationId(e.target.value); setPage(1); }}>
                <option value="">Toutes les installations</option>
                {installations.map((i) => <option key={i.id} value={i.installationId}>{i.accountLogin}</option>)}
              </Select>
            </div>
          )}
          {reposData && <p className="text-sm tabular-nums text-muted lg:ml-auto">{reposData.total ?? reposData.items.length} dépôt(s)</p>}
        </div>
      )}

      {/* Dépôts */}
      {reposLoading && (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      )}

      {isError && (
        <ErrorState title="Impossible de charger les dépôts" description={error instanceof Error ? error.message : undefined} onRetry={() => refetchRepos()} />
      )}

      {reposData && reposData.items.length === 0 && hasInstallations && (
        <EmptyState
          icon={Github}
          title={filtered ? "Aucun résultat" : "Aucun dépôt accessible"}
          description={filtered ? "Aucun dépôt ne correspond à ces filtres." : "Vérifiez que l'installation a accès à des dépôts, puis synchronisez-la."}
          action={filtered ? <Button variant="secondary" onClick={() => { setSearch(""); setVisibility(""); setSelectedInstallationId(""); setPage(1); }}>Réinitialiser les filtres</Button> : undefined}
        />
      )}

      {reposData && reposData.items.length > 0 && (
        <>
          <ul className="space-y-3">
            {reposData.items.map((repo) => (
              <li key={repo.id}>
                <Card className="transition-colors hover:border-primary-500/40">
                  <CardContent className="flex flex-col gap-4 py-4 md:flex-row md:items-center">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-700" title={repo.private ? "Privé" : "Public"}>
                      {repo.private ? <Lock className="h-5 w-5 text-amber-500" /> : <Globe className="h-5 w-5 text-muted" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{repo.fullName}</h3>
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-muted dark:bg-slate-700">{repo.private ? "Privé" : "Public"}</span>
                        {repo.language && (
                          <span className="rounded bg-primary-600/15 px-1.5 py-0.5 text-[11px] text-primary-600 dark:text-primary-400">{repo.language}</span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted">{repo.description ?? "Aucune description"}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                        <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" /><span className="font-mono">{repo.defaultBranch}</span></span>
                        <span>{repo.installation.accountLogin}</span>
                        {!!repo._count?.projects && <span className="text-emerald-600 dark:text-emerald-400">{repo._count.projects} projet(s) lié(s)</span>}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" onClick={() => setAssociateRepo(repo)} className="gap-1.5"><Link2 className="h-3.5 w-3.5" /> Associer</Button>
                      <a
                        href={repo.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> GitHub
                      </a>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination page={reposData.page} totalPages={reposData.totalPages} onPage={setPage} />
        </>
      )}

      <ConfirmDialog
        open={!!confirmRevokeId}
        title={`Révoquer ${revokeTarget ? `« ${revokeTarget.accountLogin} »` : "cette installation"} ?`}
        description="GitHub cessera d'envoyer des événements et les projets liés à ces dépôts seront détachés."
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
          onSuccess={() => { setAssociateRepo(null); refetchRepos(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// MODALE D'ASSOCIATION
// ============================================================
function AssociateRepositoryModal({ repository, onClose, onSuccess }: { repository: GitHubRepository; onClose: () => void; onSuccess: () => void }) {
  const toast = useToast();
  const [projectId, setProjectId] = useState("");
  const [branch, setBranch] = useState(repository.defaultBranch);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { data: projects, isLoading: projectsLoading } = useProjects({ pageSize: 100 });
  const { data: branches, isLoading: branchesLoading } = useGithubBranches(repository.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const handleSubmit = async () => {
    if (!projectId || !branch) {
      setError("Sélectionnez un projet et une branche.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await projectService.associateRepository(projectId, repository.id, branch);
      const name = projects?.items.find((p) => p.id === projectId)?.name;
      toast.show("success", name ? `Dépôt associé au projet « ${name} »` : "Dépôt associé au projet");
      onSuccess();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="associate-title"
        className="w-full max-w-md rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="associate-title" className="text-lg font-semibold">Associer à un projet</h2>
            <p className="text-xs text-muted">Les pushs sur la branche choisie lanceront un pipeline.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-md p-1.5 text-muted hover:bg-slate-100 dark:hover:bg-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="flex items-center gap-3 rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
            <Github className="h-4 w-4 shrink-0 text-muted" />
            <p className="truncate font-mono text-sm">{repository.fullName}</p>
          </div>

          <div>
            <label htmlFor="assoc-project" className="mb-1.5 block text-sm font-medium">Projet *</label>
            <Select id="assoc-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={projectsLoading}>
              <option value="">{projectsLoading ? "Chargement…" : "Choisir un projet"}</option>
              {projects?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            {projects && projects.items.length === 0 && (
              <p className="mt-1 text-xs text-muted">Aucun projet. Créez-en un depuis la page Projets.</p>
            )}
          </div>

          <div>
            <label htmlFor="assoc-branch" className="mb-1.5 block text-sm font-medium">Branche surveillée *</label>
            <Select id="assoc-branch" value={branch} onChange={(e) => setBranch(e.target.value)} disabled={branchesLoading}>
              {branchesLoading && <option value={branch}>Chargement…</option>}
              {branches?.map((b) => <option key={b.name} value={b.name}>{b.name}{b.protected ? " (protégée)" : ""}</option>)}
            </Select>
          </div>

          {error && <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-500">{error}</div>}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="secondary" onClick={onClose}>Annuler</Button>
            <Button onClick={handleSubmit} loading={loading} disabled={!projectId}>Associer</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
