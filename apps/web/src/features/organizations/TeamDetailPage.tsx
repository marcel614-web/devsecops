// apps/web/src/features/organizations/TeamDetailPage.tsx
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { isPlatformAdminRole } from "@/lib/roles";
import {
  Users,
  Github,
  RefreshCw,
  ExternalLink,
  Lock,
  Globe,
  GitBranch,
  ShieldAlert,
  CheckCircle2,
  FolderGit2,
  UserPlus,
  Trash2,
  Link2,
  Plus,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SimpleBadge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { Select } from "@/components/ui/Select";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/feedback/ErrorState";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/feedback/Toast";
import {
  useGithubTeam,
  useGithubTeamMembers,
  useGithubTeamRepos,
  useRemoveTeamMember,
  useRemoveTeamRepo,
  useSetTeamRepoPermission,
  useSyncTeam,
  useTeamProjects,
  useUpdateTeamProjectRole,
  useRemoveTeamProject,
} from "@/hooks/useGithub";
import { getErrorMessage } from "@/services/api";
import { cn, timeAgo } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import type {
  GitHubRepoPermission,
  GitHubTeamCapabilities,
  ProjectTeamRole,
} from "@/services/github.service";
import { AddTeamMemberModal } from "./AddTeamMemberModal";
import { AddTeamRepoModal } from "./AddTeamRepoModal";
import { TeamProjectAssociationModal } from "./TeamProjectAssociationModal";

const TABS = [
  { key: "overview", label: "Vue d'ensemble" },
  { key: "members", label: "Membres" },
  { key: "repos", label: "Dépôts associés" },
  { key: "projects", label: "Projets" },
];

const TEAM_ROLES: Array<{ value: ProjectTeamRole; label: string }> = [
  { value: "OWNER", label: "OWNER" },
  { value: "MAINTAINER", label: "MAINTAINER" },
  { value: "DEVELOPER", label: "DEVELOPER" },
  { value: "SECURITY_ANALYST", label: "SECURITY_ANALYST" },
  { value: "VIEWER", label: "VIEWER" },
];

export function TeamDetailPage() {
  const { installationId = "", slug = "" } = useParams<{
    installationId: string;
    slug: string;
  }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const active = searchParams.get("tab") ?? "overview";
  const toast = useToast();
  const { user } = useAuthStore();
  const isAdmin = isPlatformAdminRole(user?.role);

  const { data, isLoading, isError, error, refetch } = useGithubTeam(
    installationId || null,
    slug || null,
  );
  const syncTeam = useSyncTeam();

  const handleTab = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    setSearchParams(next);
  };

  const handleSync = async () => {
    try {
      const result = await syncTeam.mutateAsync({ installationId, slug });
      toast.show("success", `Équipe « ${result.team.name} » synchronisée`);
      await refetch();
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        title="Équipe introuvable"
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  const team = data.team;
  const capabilities = data.capabilities;
  const canWrite = isAdmin && capabilities.canWriteTeams;
  const canManageRepos = isAdmin && capabilities.canManageRepoPermissions;

  return (
    <div className="space-y-5">
      <PageHeader
        title={team.name}
        description={`Équipe GitHub de l'organisation ${team.orgLogin}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/organizations/${installationId}/teams`}>
              <Button variant="outline">Toutes les équipes</Button>
            </Link>
            {isAdmin && (
              <Button
                variant="secondary"
                onClick={handleSync}
                loading={syncTeam.isPending}
                className="gap-2"
              >
                <RefreshCw
                  className={cn("h-4 w-4", syncTeam.isPending && "animate-spin")}
                />
                Synchroniser
              </Button>
            )}
            <a
              href={team.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <ExternalLink className="h-4 w-4" /> Page GitHub
            </a>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4 py-5 md:flex-row md:items-center">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary-600/15">
            <Users className="h-6 w-6 text-primary-600 dark:text-primary-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{team.name}</h2>
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
            <p className="mt-1 text-xs text-muted">
              {team.description ?? "Aucune description"}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
              <span>
                ID GitHub <span className="font-mono">{team.githubTeamId}</span>
              </span>
              <span>{team.membersCount ?? "?"} membre(s)</span>
              <span>{team.reposCount ?? "?"} dépôt(s)</span>
              {team.parentTeamSlug && (
                <span className="inline-flex items-center gap-1">
                  <GitBranch className="h-3 w-3" /> parent :{" "}
                  <span className="font-mono">{team.parentTeamSlug}</span>
                </span>
              )}
              <span>synchronisée {timeAgo(team.lastSyncedAt)}</span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <CapabilityBadge
                label="Members: read"
                ok={capabilities.canReadTeams}
              />
              <CapabilityBadge
                label="Members: write"
                ok={capabilities.canWriteTeams}
              />
              <CapabilityBadge
                label="Administration: write"
                ok={capabilities.canManageRepoPermissions}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {capabilities.missingPermissions.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-4 text-sm text-amber-700 dark:text-amber-400">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Permissions GitHub App manquantes</p>
              <p className="mt-1 text-xs">
                {capabilities.missingPermissions.join(", ")}. Mettez à jour la
                GitHub App puis acceptez la mise à jour de l'installation sur
                l'organisation. Les actions concernées seront refusées par GitHub
                tant que ces permissions manquent.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs
        tabs={TABS}
        active={active}
        onChange={handleTab}
        className="mb-2"
      />

      <div className="min-h-[300px]">
        {active === "overview" && (
          <OverviewTab team={team} capabilities={capabilities} />
        )}
        {active === "members" && (
          <MembersTab
            installationId={installationId}
            slug={slug}
            teamName={team.name}
            canWrite={canWrite}
            isAdmin={isAdmin}
          />
        )}
        {active === "repos" && (
          <ReposTab
            installationId={installationId}
            slug={slug}
            teamName={team.name}
            canManage={canManageRepos}
            isAdmin={isAdmin}
          />
        )}
        {active === "projects" && (
          <ProjectsTab
            installationId={installationId}
            slug={slug}
            teamName={team.name}
          />
        )}
      </div>
    </div>
  );
}

function CapabilityBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <SimpleBadge
      className={
        ok
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-red-500/15 text-red-600 dark:text-red-400"
      }
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

function OverviewTab({
  team,
  capabilities,
}: {
  team: {
    name: string;
    slug: string;
    githubTeamId: string;
    orgLogin: string;
    description: string | null;
    privacy: string;
    parentTeamSlug: string | null;
    htmlUrl: string;
    membersCount: number | null;
    reposCount: number | null;
    lastSyncedAt: string;
  };
  capabilities: GitHubTeamCapabilities;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="space-y-3 py-5 text-sm">
          <h3 className="font-semibold">Informations GitHub</h3>
          <InfoRow label="Organisation" value={team.orgLogin} />
          <InfoRow label="Nom" value={team.name} />
          <InfoRow label="Slug" value={team.slug} mono />
          <InfoRow label="ID GitHub" value={team.githubTeamId} mono />
          <InfoRow label="Visibilité" value={team.privacy} />
          <InfoRow label="Équipe parente" value={team.parentTeamSlug ?? "Aucune"} />
          <InfoRow label="Membres" value={String(team.membersCount ?? "?")} />
          <InfoRow label="Dépôts" value={String(team.reposCount ?? "?")} />
          <InfoRow label="Dernière synchro" value={timeAgo(team.lastSyncedAt)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 py-5 text-sm">
          <h3 className="font-semibold">Permissions de la GitHub App</h3>
          <p className="text-xs text-muted">
            Les valeurs ci-dessous proviennent de l'installation GitHub App. Elles
            ne représentent pas les droits internes DevSecOps.
          </p>
          <div className="space-y-1.5">
            {Object.entries(capabilities.appPermissions)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded bg-slate-100/60 px-2.5 py-1.5 dark:bg-slate-800/40"
                >
                  <span className="font-mono text-xs">{key}</span>
                  <SimpleBadge>{value}</SimpleBadge>
                </div>
              ))}
          </div>
          {capabilities.missingPermissions.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Manquantes : {capabilities.missingPermissions.join(", ")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 pb-1.5 last:border-0">
      <span className="text-muted">{label}</span>
      <span className={cn("text-right", mono && "font-mono text-xs")}>{value}</span>
    </div>
  );
}

// ============================================================
// ONGLET MEMBRES
// ============================================================

function MembersTab({
  installationId,
  slug,
  teamName,
  canWrite,
  isAdmin,
}: {
  installationId: string;
  slug: string;
  teamName: string;
  canWrite: boolean;
  isAdmin: boolean;
}) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [role, setRole] = useState<"" | "member" | "maintainer">("");
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useGithubTeamMembers(
    installationId,
    slug,
    {
      page,
      pageSize: 30,
      role: role || undefined,
    },
  );
  const removeMember = useRemoveTeamMember(installationId, slug);

  const handleRemove = async () => {
    if (!pendingRemove) return;
    try {
      await removeMember.mutateAsync(pendingRemove);
      toast.show(
        "success",
        `« ${pendingRemove} » a été retiré de l'équipe sur GitHub`,
      );
      setPendingRemove(null);
      await refetch();
    } catch (err) {
      toast.show("error", getErrorMessage(err));
      setPendingRemove(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <label htmlFor="member-role-filter" className="text-sm text-muted">
            Rôle
          </label>
          <Select
            id="member-role-filter"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as "" | "member" | "maintainer");
              setPage(1);
            }}
            className="w-40"
          >
            <option value="">Tous</option>
            <option value="maintainer">Maintainers</option>
            <option value="member">Members</option>
          </Select>
        </div>
        {data && (
          <p className="text-sm tabular-nums text-muted sm:ml-2">
            {data.total} membre(s) actif(s)
            {data.pendingInvitations.length > 0
              ? ` · ${data.pendingInvitations.length} invitation(s) en attente`
              : ""}
          </p>
        )}
        <div className="flex items-center gap-2 sm:ml-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Actualiser
          </Button>
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            disabled={!canWrite}
            title={
              !isAdmin
                ? "Action réservée aux administrateurs de la plateforme"
                : !canWrite
                  ? "Permission GitHub App « Members: write » requise"
                  : undefined
            }
            className="gap-1.5"
          >
            <UserPlus className="h-3.5 w-3.5" /> Ajouter un membre
          </Button>
        </div>
      </div>

      {!canWrite && isAdmin && (
        <p className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 text-xs text-muted">
          Lecture seule : la permission GitHub App « Members: write » n'est pas
          accordée. GitHub refusera tout ajout ou retrait.
        </p>
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-lg" />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les membres"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {data && data.pendingInvitations.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="space-y-2 py-4">
            <h3 className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Invitations en attente
            </h3>
            {data.pendingInvitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex items-center gap-3 rounded-md bg-surface/70 px-3 py-2"
              >
                <MemberAvatar
                  login={invitation.login}
                  avatarUrl={invitation.avatarUrl}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{invitation.login}</p>
                  <p className="text-xs text-muted">
                    Rôle {invitation.role} · invitation en attente d'acceptation
                  </p>
                </div>
                <SimpleBadge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  En attente
                </SimpleBadge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={Users}
          title={
            role
              ? "Aucun membre pour ce filtre"
              : "Aucun membre actif dans cette équipe"
          }
          description={
            role
              ? "Changez le filtre de rôle pour afficher les autres membres."
              : "Ajoutez un membre depuis DevSecOps Manager. GitHub peut créer une invitation en attente."
          }
          action={
            canWrite ? (
              <Button onClick={() => setAddOpen(true)} className="gap-2">
                <UserPlus className="h-4 w-4" /> Ajouter un membre
              </Button>
            ) : undefined
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {data.items.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <MemberAvatar
                  login={member.login}
                  avatarUrl={member.avatarUrl}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={member.htmlUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm font-medium hover:text-primary-600"
                    >
                      {member.login}
                    </a>
                    <SimpleBadge
                      className={
                        member.role === "maintainer"
                          ? "bg-primary-600/15 text-primary-600 dark:text-primary-400"
                          : ""
                      }
                    >
                      {member.role}
                    </SimpleBadge>
                    <SimpleBadge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      {member.state}
                    </SimpleBadge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    ID GitHub <span className="font-mono">{member.id}</span>
                    {" · "}appartenance {member.source === "direct" ? "directe" : "héritée"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setPendingRemove(member.login)}
                  disabled={!canWrite}
                  title={
                    canWrite
                      ? `Retirer ${member.login} de l'équipe GitHub`
                      : "Permission « Members: write » requise"
                  }
                  aria-label={`Retirer ${member.login}`}
                  className="text-red-500 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
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

      {data && !data.complete && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          La liste des membres est partielle (limite de pagination GitHub).
        </p>
      )}

      <ConfirmDialog
        open={!!pendingRemove}
        title={`Retirer « ${pendingRemove} » de l'équipe ?`}
        description="Cette action supprime réellement l'appartenance à l'équipe sur GitHub. Elle est distincte des rôles internes DevSecOps et ne peut pas être annulée automatiquement."
        confirmLabel="Retirer sur GitHub"
        danger
        loading={removeMember.isPending}
        onConfirm={handleRemove}
        onCancel={() => setPendingRemove(null)}
      />

      {addOpen && (
        <AddTeamMemberModal
          installationId={installationId}
          slug={slug}
          teamName={teamName}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            void refetch();
          }}
        />
      )}
    </div>
  );
}

function MemberAvatar({
  login,
  avatarUrl,
}: {
  login: string;
  avatarUrl: string | null;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="h-9 w-9 shrink-0 rounded-full bg-slate-200 object-cover dark:bg-slate-700"
      />
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
      {login.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ============================================================
// ONGLET DÉPÔTS ASSOCIÉS
// ============================================================

const REPO_PERMISSIONS: Array<{
  value: GitHubRepoPermission;
  label: string;
}> = [
  { value: "pull", label: "pull" },
  { value: "triage", label: "triage" },
  { value: "push", label: "push" },
  { value: "maintain", label: "maintain" },
  { value: "admin", label: "admin" },
];

function ReposTab({
  installationId,
  slug,
  teamName,
  canManage,
  isAdmin,
}: {
  installationId: string;
  slug: string;
  teamName: string;
  canManage: boolean;
  isAdmin: boolean;
}) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<{
    owner: string;
    repo: string;
    fullName: string;
  } | null>(null);

  const { data, isLoading, isError, error, refetch } = useGithubTeamRepos(
    installationId,
    slug,
    page,
  );
  const setPermission = useSetTeamRepoPermission(installationId, slug);
  const removeRepo = useRemoveTeamRepo(installationId, slug);

  const handlePermission = async (
    owner: string,
    repo: string,
    permission: GitHubRepoPermission,
  ) => {
    try {
      const result = await setPermission.mutateAsync({
        owner,
        repo,
        permission,
      });
      toast.show(
        "success",
        `Permission « ${result.permission} » appliquée à ${result.repository} sur GitHub`,
      );
      await refetch();
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    }
  };

  const handleRemove = async () => {
    if (!pendingRemove) return;
    try {
      await removeRepo.mutateAsync({
        owner: pendingRemove.owner,
        repo: pendingRemove.repo,
      });
      toast.show(
        "success",
        `Dépôt ${pendingRemove.fullName} retiré de l'équipe sur GitHub`,
      );
      setPendingRemove(null);
      await refetch();
    } catch (err) {
      toast.show("error", getErrorMessage(err));
      setPendingRemove(null);
    }
  };

  const existingFullNames = (data?.items ?? []).map((repo) => repo.fullName);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted">
          Permissions GitHub appliquées à l'équipe sur les dépôts de
          l'organisation.
        </p>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Actualiser
          </Button>
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            disabled={!canManage}
            title={
              !isAdmin
                ? "Action réservée aux administrateurs de la plateforme"
                : !canManage
                  ? "Permission GitHub App « Administration: write » requise"
                  : undefined
            }
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Associer un dépôt
          </Button>
        </div>
      </div>

      {!canManage && isAdmin && (
        <p className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 text-xs text-muted">
          Lecture seule : la permission GitHub App « Administration: write »
          n'est pas accordée. GitHub refusera toute modification d'accès aux
          dépôts.
        </p>
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-lg" />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les dépôts associés"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={Github}
          title="Aucun dépôt associé"
          description="Associez un dépôt de l'organisation à cette équipe. GitHub appliquera réellement la permission choisie."
          action={
            canManage ? (
              <Button onClick={() => setAddOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" /> Associer un dépôt
              </Button>
            ) : undefined
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {data.items.map((repo) => (
              <li
                key={repo.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={repo.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate font-mono text-sm font-medium hover:text-primary-600"
                    >
                      {repo.fullName}
                    </a>
                    {repo.private && (
                      <SimpleBadge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        <Lock className="mr-1 h-3 w-3" /> privé
                      </SimpleBadge>
                    )}
                  </div>
                  {repo.description && (
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {repo.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Select
                    value={repo.permission ?? ""}
                    onChange={(e) =>
                      handlePermission(
                        repo.owner,
                        repo.name,
                        e.target.value as GitHubRepoPermission,
                      )
                    }
                    disabled={!canManage || setPermission.isPending}
                    aria-label={`Permission GitHub pour ${repo.fullName}`}
                    className="w-32"
                  >
                    {!repo.permission && <option value="">inconnue</option>}
                    {REPO_PERMISSIONS.map((permission) => (
                      <option key={permission.value} value={permission.value}>
                        {permission.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setPendingRemove({
                        owner: repo.owner,
                        repo: repo.name,
                        fullName: repo.fullName,
                      })
                    }
                    disabled={!canManage}
                    title={
                      canManage
                        ? `Retirer ${repo.fullName} de l'équipe`
                        : "Permission « Administration: write » requise"
                    }
                    aria-label={`Retirer ${repo.fullName}`}
                    className="text-red-500 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">Page {data.page}</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                Précédent
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => current + 1)}
                disabled={!data.hasNext}
              >
                Suivant
              </Button>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!pendingRemove}
        title={`Retirer ${pendingRemove?.fullName ?? "ce dépôt"} ?`}
        description="Cette action retire réellement l'accès de l'équipe au dépôt sur GitHub. Les permissions internes du projet DevSecOps ne sont pas modifiées."
        confirmLabel="Retirer sur GitHub"
        danger
        loading={removeRepo.isPending}
        onConfirm={handleRemove}
        onCancel={() => setPendingRemove(null)}
      />

      {addOpen && (
        <AddTeamRepoModal
          installationId={installationId}
          slug={slug}
          teamName={teamName}
          existingFullNames={existingFullNames}
          canManage={canManage}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            void refetch();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// ONGLET PROJETS DEVSEOPS
// ============================================================

function ProjectsTab({
  installationId,
  slug,
  teamName,
}: {
  installationId: string;
  slug: string;
  teamName: string;
}) {
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const { data, isLoading, isError, error, refetch } = useTeamProjects(
    installationId,
    slug,
  );
  const updateRole = useUpdateTeamProjectRole(installationId, slug);
  const removeLink = useRemoveTeamProject(installationId, slug);

  const handleRoleChange = async (
    linkId: string,
    role: ProjectTeamRole,
  ) => {
    try {
      await updateRole.mutateAsync({ linkId, role });
      toast.show("success", `Rôle interne mis à jour : ${role}`);
      await refetch();
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    }
  };

  const handleRemove = async () => {
    if (!pendingRemove) return;
    try {
      await removeLink.mutateAsync(pendingRemove.id);
      toast.show(
        "success",
        `Association avec le projet « ${pendingRemove.name} » supprimée`,
      );
      setPendingRemove(null);
      await refetch();
    } catch (err) {
      toast.show("error", getErrorMessage(err));
      setPendingRemove(null);
    }
  };

  const existingProjectIds = (data?.items ?? []).map(
    (link) => link.project.id,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted">
          Associations aux projets DevSecOps. Le rôle interne est appliqué par
          l'API de la plateforme, jamais par GitHub.
        </p>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Actualiser
          </Button>
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            className="gap-1.5"
          >
            <Link2 className="h-3.5 w-3.5" /> Associer à un projet
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 text-xs text-muted">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Un changement de rôle GitHub ne modifie jamais les permissions internes
          de déploiement ou de Security Gates. Inversement, le rôle interne défini
          ici ne modifie pas l'accès GitHub de l'équipe.
        </span>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-lg" />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les associations"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={FolderGit2}
          title="Aucun projet associé"
          description="Associez cette équipe GitHub à un projet DevSecOps pour lui attribuer un rôle interne."
          action={
            <Button onClick={() => setAddOpen(true)} className="gap-2">
              <Link2 className="h-4 w-4" /> Associer à un projet
            </Button>
          }
        />
      )}

      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {data.items.map((link) => (
            <li
              key={link.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to={`/projects/${link.project.id}`}
                  className="truncate text-sm font-medium hover:text-primary-600"
                >
                  {link.project.name}
                </Link>
                <p className="mt-0.5 font-mono text-xs text-muted">
                  {link.project.repoFullName}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={link.role}
                  onChange={(e) =>
                    handleRoleChange(
                      link.id,
                      e.target.value as ProjectTeamRole,
                    )
                  }
                  disabled={updateRole.isPending}
                  aria-label={`Rôle interne pour ${link.project.name}`}
                  className="w-44"
                >
                  {TEAM_ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setPendingRemove({
                      id: link.id,
                      name: link.project.name,
                    })
                  }
                  title={`Supprimer l'association avec ${link.project.name}`}
                  aria-label={`Supprimer l'association avec ${link.project.name}`}
                  className="text-red-500 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!pendingRemove}
        title={`Supprimer l'association avec « ${pendingRemove?.name ?? "ce projet"} » ?`}
        description="Seule l'association interne est supprimée. L'équipe et ses accès GitHub ne sont pas modifiés."
        confirmLabel="Supprimer l'association"
        danger
        loading={removeLink.isPending}
        onConfirm={handleRemove}
        onCancel={() => setPendingRemove(null)}
      />

      {addOpen && (
        <TeamProjectAssociationModal
          installationId={installationId}
          slug={slug}
          teamName={teamName}
          existingProjectIds={existingProjectIds}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
