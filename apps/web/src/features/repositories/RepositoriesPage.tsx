// apps/web/src/features/repositories/RepositoriesPage.tsx
import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Github,
  ExternalLink,
  Lock,
  Globe,
  GitBranch,
  CheckCircle2,
  Unplug,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import {
  useDisconnectGithub,
  useGithubRepos,
  useGithubStatus,
} from "@/hooks/useGithub";
import { githubService } from "@/services/github.service";
import { getErrorMessage } from "@/services/api";
import { timeAgo } from "@/lib/utils";
import { useState } from "react";

export function RepositoriesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useGithubStatus();
  const { data: reposData, isLoading: reposLoading, isError: reposError, error: reposErr, refetch: refetchRepos } =
    useGithubRepos(!!status?.connected);
  const disconnectMutation = useDisconnectGithub();

  // ----------------------------------------------------------
  // Traite le retour OAuth (success/error)
  // ----------------------------------------------------------
  useEffect(() => {
    const ghStatus = searchParams.get("github");
    const login = searchParams.get("login");
    const reason = searchParams.get("reason");

    if (ghStatus === "success") {
      toast.show("success", `GitHub connecté : ${login ?? ""}`);
      refetchStatus();
      refetchRepos();
      // Nettoie l'URL
      const next = new URLSearchParams(searchParams);
      next.delete("github");
      next.delete("login");
      next.delete("reason");
      setSearchParams(next, { replace: true });
    } else if (ghStatus === "error") {
      toast.show("error", `Échec de connexion GitHub : ${reason ?? "inconnu"}`);
      const next = new URLSearchParams(searchParams);
      next.delete("github");
      next.delete("login");
      next.delete("reason");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, toast, refetchStatus, refetchRepos]);

  const handleConnect = () => {
    window.location.href = githubService.getConnectUrl();
  };

  const handleDisconnect = async () => {
    try {
      await disconnectMutation.mutateAsync();
      toast.show("success", "Compte GitHub déconnecté");
      setConfirmDisconnect(false);
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Repositories"
        description="Dépôts Git connectés à la plateforme"
      />

      {/* ------------------------------------------------------
          Bloc de connexion GitHub
      ------------------------------------------------------ */}
      {statusLoading ? (
        <Skeleton className="h-24 mb-6" />
      ) : status?.connected ? (
        <Card className="mb-6 border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                GitHub connecté : <strong>{status.login}</strong>
              </p>
              <p className="text-xs text-muted mt-0.5">
                Scopes : {status.scopes ?? "—"} ·{" "}
                {status.connectedAt
                  ? `Connecté ${timeAgo(status.connectedAt)}`
                  : ""}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDisconnect(true)}
            >
              <Unplug className="w-4 h-4" /> Déconnecter
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-6 border-primary-500/40 bg-primary-600/5">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="w-10 h-10 rounded-full bg-primary-600/15 flex items-center justify-center shrink-0">
              <Github className="w-5 h-5 text-primary-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Connecte ton compte GitHub</p>
              <p className="text-xs text-muted mt-0.5">
                Autorise la plateforme à lister tes repositories publics et
                privés. Aucun mot de passe n'est demandé.
              </p>
            </div>
            <Button onClick={handleConnect}>
              <Github className="w-4 h-4" /> Connecter GitHub
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------
          Liste des repositories
      ------------------------------------------------------ */}
      {status?.connected && (
        <>
          {reposLoading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          )}

          {reposError && (
            <ErrorState
              title="Impossible de charger les repositories"
              description={reposErr instanceof Error ? reposErr.message : undefined}
              onRetry={() => refetchRepos()}
            />
          )}

          {reposData && reposData.repositories.length === 0 && (
            <EmptyState
              icon={Github}
              title="Aucun repository"
              description="Ton compte GitHub ne contient aucun repository accessible."
            />
          )}

          {reposData && reposData.repositories.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                {reposData.total} repository(ies) accessibles
              </p>
              {reposData.repositories.map((repo) => (
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
                        <h3 className="font-semibold text-sm truncate">
                          {repo.full_name}
                        </h3>
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-muted">
                          {repo.private ? "Privé" : "Public"}
                        </span>
                        {repo.language && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-600/15 text-primary-600 dark:text-primary-500">
                            {repo.language}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-1 truncate">
                        {repo.description ?? "Pas de description"}
                      </p>
                      <p className="text-xs text-muted mt-0.5">
                        Branche par défaut :{" "}
                        <span className="font-mono">{repo.default_branch}</span>{" "}
                        · Mis à jour {timeAgo(repo.updated_at)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        to={`/projects/new?repo=${encodeURIComponent(repo.full_name)}`}
                        className="text-xs px-3 py-1.5 rounded-md bg-primary-600 hover:bg-primary-700 text-white transition-colors inline-flex items-center gap-1.5"
                      >
                        <GitBranch className="w-3.5 h-3.5" />
                        Créer un projet
                      </Link>
                      <a
                        href={repo.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors inline-flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        GitHub
                      </a>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        title="Déconnecter GitHub ?"
        description="Tu ne pourras plus accéder à tes repositories depuis la plateforme tant que tu n'auras pas reconnecté ton compte. Les projets existants ne seront pas supprimés."
        confirmLabel="Déconnecter"
        danger
        loading={disconnectMutation.isPending}
        onConfirm={handleDisconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}