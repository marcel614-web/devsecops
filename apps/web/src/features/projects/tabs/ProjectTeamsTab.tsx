// apps/web/src/features/projects/tabs/ProjectTeamsTab.tsx
import { useMemo, useState } from "react";
import { Github, Users, Plus, Trash2, ShieldAlert, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { SimpleBadge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/feedback/Toast";
import {
  useAssociateProjectTeam,
  useAvailableProjectTeams,
  useProjectTeams,
  useRemoveProjectTeam,
  useUpdateProjectTeamRole,
} from "@/hooks/useProjects";
import { getErrorMessage } from "@/services/api";
import type { ProjectTeamRole } from "@/services/github.service";

const ROLES: Array<{ value: ProjectTeamRole; label: string }> = [
  { value: "OWNER", label: "OWNER" },
  { value: "MAINTAINER", label: "MAINTAINER" },
  { value: "DEVELOPER", label: "DEVELOPER" },
  { value: "SECURITY_ANALYST", label: "SECURITY_ANALYST" },
  { value: "VIEWER", label: "VIEWER" },
];

export function ProjectTeamsTab({ projectId }: { projectId: string }) {
  const toast = useToast();
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState<ProjectTeamRole>("VIEWER");
  const [pendingRemove, setPendingRemove] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const {
    data: links,
    isLoading,
    isError,
    error,
    refetch,
  } = useProjectTeams(projectId);
  const { data: availableTeams, isLoading: availableLoading } =
    useAvailableProjectTeams(projectId);
  const associate = useAssociateProjectTeam(projectId);
  const updateRole = useUpdateProjectTeamRole(projectId);
  const removeLink = useRemoveProjectTeam(projectId);

  const linkedIds = useMemo(
    () => new Set((links ?? []).map((link) => link.team.id)),
    [links],
  );
  const available = (availableTeams ?? []).filter(
    (team) => !linkedIds.has(team.id),
  );

  const handleAssociate = async () => {
    if (!teamId) return;
    try {
      await associate.mutateAsync({ githubTeamId: teamId, role });
      toast.show("success", "Équipe GitHub associée au projet");
      setTeamId("");
      setRole("VIEWER");
      await refetch();
    } catch (err) {
      toast.show("error", getErrorMessage(err));
    }
  };

  const handleRole = async (linkId: string, nextRole: ProjectTeamRole) => {
    try {
      await updateRole.mutateAsync({ linkId, role: nextRole });
      toast.show("success", `Rôle interne mis à jour : ${nextRole}`);
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
        `Association avec « ${pendingRemove.name} » supprimée`,
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
      <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 text-xs text-muted">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Le rôle interne est appliqué uniquement par l'API DevSecOps Manager. Il
          ne modifie pas les permissions GitHub de l'équipe, et un rôle GitHub ne
          modifie pas automatiquement les droits internes de déploiement ou de
          Security Gates.
        </span>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="project-team"
            className="mb-1 block text-xs font-medium text-muted"
          >
            Équipe GitHub
          </label>
          <Select
            id="project-team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            disabled={availableLoading}
          >
            <option value="">
              {availableLoading
                ? "Chargement…"
                : available.length === 0
                  ? "Aucune équipe disponible (synchronisez une organisation)"
                  : "Choisir une équipe"}
            </option>
            {available.map((team) => (
              <option key={team.id} value={team.id}>
                {team.orgLogin}/{team.name} ({team.slug})
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <label
            htmlFor="project-team-role"
            className="mb-1 block text-xs font-medium text-muted"
          >
            Rôle interne
          </label>
          <Select
            id="project-team-role"
            value={role}
            onChange={(e) => setRole(e.target.value as ProjectTeamRole)}
          >
            {ROLES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>
        <Button
          onClick={handleAssociate}
          loading={associate.isPending}
          disabled={!teamId}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" /> Associer
        </Button>
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
          title="Impossible de charger les équipes du projet"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {links && links.length === 0 && (
        <EmptyState
          icon={Users}
          title="Aucune équipe GitHub associée"
          description="Sélectionnez une équipe synchronisée depuis GitHub et attribuez-lui un rôle interne à ce projet."
        />
      )}

      {links && links.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">{links.length} équipe(s) associée(s)</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Actualiser
            </Button>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {links.map((link) => (
              <li
                key={link.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/organizations/${link.team.installation?.installationId ?? link.team.installationId}/teams/${link.team.slug}`}
                      className="truncate text-sm font-medium hover:text-primary-600"
                    >
                      {link.team.name}
                    </Link>
                    <SimpleBadge className="font-mono">{link.team.slug}</SimpleBadge>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Github className="h-3 w-3" />
                      {link.team.orgLogin}
                    </span>
                    <span>
                      ID GitHub{" "}
                      <span className="font-mono">{link.team.githubTeamId}</span>
                    </span>
                    <span>{link.team.membersCount ?? "?"} membre(s)</span>
                    {link.team.syncState === "DELETED" && (
                      <span className="text-amber-600 dark:text-amber-400">
                        Équipe supprimée sur GitHub
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={link.role}
                    onChange={(e) =>
                      handleRole(link.id, e.target.value as ProjectTeamRole)
                    }
                    disabled={updateRole.isPending}
                    aria-label={`Rôle interne pour ${link.team.name}`}
                    className="w-44"
                  >
                    {ROLES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setPendingRemove({ id: link.id, name: link.team.name })
                    }
                    title={`Retirer l'association avec ${link.team.name}`}
                    aria-label={`Retirer l'association avec ${link.team.name}`}
                    className="text-red-500 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={!!pendingRemove}
        title={`Supprimer l'association avec « ${pendingRemove?.name ?? "cette équipe"} » ?`}
        description="Seule l'association interne au projet est supprimée. L'équipe GitHub et ses accès ne sont pas modifiés."
        confirmLabel="Supprimer l'association"
        danger
        loading={removeLink.isPending}
        onConfirm={handleRemove}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
