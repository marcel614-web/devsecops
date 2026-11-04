// apps/web/src/features/organizations/OrganizationsPage.tsx
import { Link } from "react-router-dom";
import { isPlatformAdminRole } from "@/lib/roles";
import {
  Building2,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  CheckCircle2,
  Github,
  Users,
  Lock,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SimpleBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/feedback/Toast";
import {
  useGithubOrganizations,
  useSyncOrganization,
} from "@/hooks/useGithub";
import { getErrorMessage } from "@/services/api";
import { timeAgo, cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import type { GitHubOrganization } from "@/services/github.service";

function PermissionBadge({
  label,
  ok,
}: {
  label: string;
  ok: boolean;
}) {
  return (
    <SimpleBadge
      className={cn(
        ok
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-red-500/15 text-red-600 dark:text-red-400",
      )}
    >
      {ok ? (
        <CheckCircle2 className="mr-1 h-3 w-3" />
      ) : (
        <Lock className="mr-1 h-3 w-3" />
      )}
      {label}
    </SimpleBadge>
  );
}

function OrganizationCard({ organization }: { organization: GitHubOrganization }) {
  const toast = useToast();
  const { user } = useAuthStore();
  const isAdmin = isPlatformAdminRole(user?.role);
  const syncMutation = useSyncOrganization();

  const handleSync = async () => {
    try {
      const result = await syncMutation.mutateAsync(organization.installationId);
      toast.show(
        "success",
        `Organisation synchronisée : ${result.teamsSynced} équipe(s)${
          result.complete ? "" : " (liste partielle)"
        }`,
      );
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    }
  };

  const capabilities = organization.capabilities;

  return (
    <Card className="transition-colors hover:border-primary-500/40">
      <CardContent className="flex flex-col gap-4 py-5 lg:flex-row lg:items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-200 dark:bg-slate-700">
          {organization.avatarUrl ? (
            <img
              src={organization.avatarUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <Building2 className="h-5 w-5 text-muted" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{organization.login}</h3>
            <SimpleBadge className="bg-primary-600/15 text-primary-600 dark:text-primary-400">
              Organisation
            </SimpleBadge>
            {organization.orgSyncState === "ERROR" && (
              <SimpleBadge className="bg-amber-500/15 text-amber-600 dark:text-amber-500">
                Dernière synchro en erreur
              </SimpleBadge>
            )}
          </div>

          <p className="mt-1 text-xs text-muted">
            ID GitHub <span className="font-mono">{organization.githubOrgId}</span>
            {" · "}installation{" "}
            <span className="font-mono">{organization.installationId}</span>
            {" · "}
            {organization.repositoryCount} dépôt(s)
            {" · "}
            {organization.teamCount} équipe(s) en cache
          </p>

          <p className="mt-1 text-xs text-muted">
            {organization.lastOrgSyncedAt
              ? `Synchronisée ${timeAgo(organization.lastOrgSyncedAt)}`
              : "Jamais synchronisée"}
            {organization.description ? ` · ${organization.description}` : ""}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PermissionBadge label="Members: read" ok={capabilities.canReadTeams} />
            <PermissionBadge label="Members: write" ok={capabilities.canWriteTeams} />
            <PermissionBadge
              label="Administration: write"
              ok={capabilities.canManageRepoPermissions}
            />
          </div>

          {organization.error && (
            <div
              role="alert"
              className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400"
            >
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{organization.error}</span>
            </div>
          )}

          {!capabilities.canReadTeams && !organization.error && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                La permission GitHub App « Members: read » est nécessaire pour
                afficher les équipes. Mettez à jour l'installation de
                l'application sur cette organisation.
              </span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link to={`/organizations/${organization.installationId}/teams`}>
            <Button size="sm" className="gap-1.5">
              <Users className="h-3.5 w-3.5" /> Équipes
            </Button>
          </Link>
          <a
            href={organization.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <ExternalLink className="h-3.5 w-3.5" /> GitHub
          </a>
          {isAdmin && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSync}
              disabled={syncMutation.isPending}
              title="Synchroniser l'organisation et ses équipes"
              aria-label={`Synchroniser ${organization.login}`}
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4",
                  syncMutation.isPending && "animate-spin",
                )}
              />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function OrganizationsPage() {
  const { data, isLoading, isError, error, refetch } = useGithubOrganizations();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Organisations GitHub"
        description="Organisations accessibles via vos installations de la GitHub App"
        actions={
          <Link to="/repositories">
            <Button variant="outline" className="gap-2">
              <Github className="h-4 w-4" /> Gérer les installations
            </Button>
          </Link>
        }
      />

      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="py-3 text-xs text-muted">
          Les équipes GitHub ne sont disponibles que pour les organisations.
          Un compte personnel GitHub n'est jamais traité comme une organisation :
          ses dépôts restent gérés depuis la page Repositories.
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les organisations"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {data && data.length === 0 && (
        <EmptyState
          icon={Building2}
          title="Aucune organisation connectée"
          description="Installez la GitHub App sur une organisation pour pouvoir gérer ses équipes. Les comptes personnels ne sont pas des organisations."
          action={
            <Link to="/repositories">
              <Button className="gap-2">
                <Github className="h-4 w-4" /> Installer la GitHub App
              </Button>
            </Link>
          }
        />
      )}

      {data && data.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm tabular-nums text-muted">
            {data.length} organisation(s)
          </p>
          {data.map((organization) => (
            <OrganizationCard
              key={organization.id}
              organization={organization}
            />
          ))}
        </div>
      )}
    </div>
  );
}
