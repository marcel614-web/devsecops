// apps/web/src/features/organizations/TeamsPage.tsx
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isPlatformAdminRole } from "@/lib/roles";
import {
  Github,
  Plus,
  RefreshCw,
  Users,
  Lock,
  Globe,
  ExternalLink,
  ShieldAlert,
  GitBranch,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SimpleBadge } from "@/components/ui/Badge";
import { SearchInput } from "@/components/ui/SearchInput";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/feedback/Toast";
import {
  useGithubOrganizations,
  useGithubTeams,
  useSyncOrganization,
} from "@/hooks/useGithub";
import { getErrorMessage } from "@/services/api";
import { cn, timeAgo } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { CreateTeamModal } from "./CreateTeamModal";

const PRIVACY_FILTERS = [
  { key: "", label: "Toutes" },
  { key: "closed", label: "Closed" },
  { key: "secret", label: "Secret" },
] as const;

export function TeamsPage() {
  const { installationId = "" } = useParams<{ installationId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuthStore();
  const isAdmin = isPlatformAdminRole(user?.role);

  const [search, setSearch] = useState("");
  const [privacy, setPrivacy] = useState<"" | "closed" | "secret">("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: organizations } = useGithubOrganizations();
  const organization = organizations?.find(
    (item) => item.installationId === installationId,
  );

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useGithubTeams(installationId || null, {
    search: search || undefined,
    privacy: privacy || undefined,
    page,
    pageSize: 30,
  });

  const syncOrganization = useSyncOrganization();

  const handleRefresh = async () => {
    await refetch();
    toast.show("success", "Liste des équipes actualisée depuis GitHub");
  };

  const handleSyncOrganization = async () => {
    try {
      const result = await syncOrganization.mutateAsync(installationId);
      toast.show(
        "success",
        `Organisation synchronisée : ${result.teamsSynced} équipe(s)`,
      );
      await refetch();
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    }
  };

  const capabilities = data?.capabilities ?? organization?.capabilities;
  const filtered = !!search || !!privacy;
  const canCreate = isAdmin && !!capabilities?.canWriteTeams;

  return (
    <div className="space-y-5">
      <PageHeader
        title={organization ? `Équipes — ${organization.login}` : "Équipes GitHub"}
        description="Équipes réelles de l'organisation, lues depuis l'API GitHub"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/organizations">
              <Button variant="outline">Organisations</Button>
            </Link>
            <Button
              variant="secondary"
              onClick={handleRefresh}
              disabled={isFetching}
              className="gap-2"
            >
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              Actualiser
            </Button>
            {isAdmin && (
              <Button
                variant="outline"
                onClick={handleSyncOrganization}
                loading={syncOrganization.isPending}
                className="gap-2"
              >
                Synchroniser
              </Button>
            )}
            <Button
              onClick={() => setCreateOpen(true)}
              disabled={!canCreate}
              title={
                !isAdmin
                  ? "Action réservée aux administrateurs de la plateforme"
                  : capabilities && !capabilities.canWriteTeams
                    ? "Permission GitHub App « Members: write » requise"
                    : undefined
              }
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> Créer une équipe
            </Button>
          </div>
        }
      />

      {capabilities && !capabilities.canReadTeams && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-4 text-sm text-amber-700 dark:text-amber-400">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Permission GitHub App insuffisante</p>
              <p className="mt-1 text-xs">
                La permission « Members: read » est nécessaire pour lister les
                équipes. Accordez-la à la GitHub App, puis acceptez la mise à jour
                de l'installation sur l'organisation.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {capabilities && capabilities.canReadTeams && !capabilities.canWriteTeams && isAdmin && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="py-3 text-xs text-muted">
            Lecture seule : la permission « Members: write » n'est pas accordée à
            la GitHub App. La création d'équipes et la gestion des membres seront
            refusées par GitHub.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="w-full lg:max-w-sm">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Rechercher une équipe…"
          />
        </div>
        <div
          role="group"
          aria-label="Visibilité de l'équipe"
          className="inline-flex rounded-md border border-border p-0.5"
        >
          {PRIVACY_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              aria-pressed={privacy === filter.key}
              onClick={() => {
                setPrivacy(filter.key);
                setPage(1);
              }}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary-500",
                privacy === filter.key
                  ? "bg-primary-600 text-white"
                  : "text-muted hover:text-slate-800 dark:hover:text-slate-100",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {data && (
          <p className="text-sm tabular-nums text-muted lg:ml-auto">
            {data.total} équipe(s)
            {data.complete ? "" : " · liste partielle (limite de pagination)"}
          </p>
        )}
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les équipes"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {data && data.items.length === 0 && capabilities?.canReadTeams && (
        <EmptyState
          icon={Users}
          title={filtered ? "Aucune équipe ne correspond" : "Aucune équipe GitHub"}
          description={
            filtered
              ? "Modifiez la recherche ou les filtres."
              : "Cette organisation ne possède encore aucune équipe. Créez-en une depuis DevSecOps Manager."
          }
          action={
            filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setPrivacy("");
                  setPage(1);
                }}
              >
                Réinitialiser les filtres
              </Button>
            ) : canCreate ? (
              <Button onClick={() => setCreateOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" /> Créer une équipe
              </Button>
            ) : undefined
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <ul className="space-y-3">
            {data.items.map((team) => (
              <li key={team.id}>
                <Card className="transition-colors hover:border-primary-500/40">
                  <CardContent className="flex flex-col gap-4 py-4 md:flex-row md:items-center">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-700">
                      <Users className="h-5 w-5 text-muted" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{team.name}</h3>
                        <SimpleBadge className="font-mono">{team.slug}</SimpleBadge>
                        <SimpleBadge
                          className={
                            team.privacy === "secret"
                              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                              : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                          }
                        >
                          {team.privacy === "secret" ? (
                            <Lock className="mr-1 h-3 w-3" />
                          ) : (
                            <Globe className="mr-1 h-3 w-3" />
                          )}
                          {team.privacy}
                        </SimpleBadge>
                      </div>

                      <p className="mt-1 truncate text-xs text-muted">
                        {team.description ?? "Aucune description"}
                      </p>

                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                        <span>
                          ID GitHub{" "}
                          <span className="font-mono">{team.githubTeamId}</span>
                        </span>
                        <span>{team.membersCount ?? "?"} membre(s)</span>
                        <span>{team.reposCount ?? "?"} dépôt(s)</span>
                        {team.parentTeamSlug && (
                          <span className="inline-flex items-center gap-1">
                            <GitBranch className="h-3 w-3" />
                            parent : <span className="font-mono">{team.parentTeamSlug}</span>
                          </span>
                        )}
                        <span>synchronisée {timeAgo(team.lastSyncedAt)}</span>
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Link to={`/organizations/${installationId}/teams/${team.slug}`}>
                        <Button size="sm" className="gap-1.5">
                          <Users className="h-3.5 w-3.5" /> Détails
                        </Button>
                      </Link>
                      <a
                        href={team.htmlUrl}
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
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onPage={setPage}
          />
        </>
      )}

      {createOpen && (
        <CreateTeamModal
          installationId={installationId}
          organizationLogin={data?.organization.login ?? organization?.login ?? ""}
          onClose={() => setCreateOpen(false)}
          onCreated={(team) => {
            setCreateOpen(false);
            navigate(
              `/organizations/${installationId}/teams/${team.slug}`,
            );
          }}
        />
      )}

      {!data && !isLoading && !isError && (
        <EmptyState
          icon={Github}
          title="Équipes indisponibles"
          description="Sélectionnez une organisation GitHub pour afficher ses équipes."
          action={
            <Link to="/organizations">
              <Button variant="secondary">Voir les organisations</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}
