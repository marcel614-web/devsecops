import { useMemo, useState } from "react";
import {
  Copy,
  Mail,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/feedback/ErrorState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import { projectService } from "@/services/project.service";
import { authorizationService } from "@/services/authorization.service";
import { getErrorMessage } from "@/services/api";
import type {
  ProjectMember,
  ProjectRole,
  SpecialPermission,
} from "@/types/api";

const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  OWNER: "Propriétaire",
  MAINTAINER: "Mainteneur",
  DEVELOPER: "Développeur",
  SECURITY_ANALYST: "Analyste sécurité",
  REPORTER: "Rapporteur",
  GUEST: "Invité",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function ProjectMembersTab({
  projectId,
  canManageMembers,
  canAssignOwner,
}: {
  projectId: string;
  canManageMembers: boolean;
  canAssignOwner: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ProjectRole>("DEVELOPER");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ProjectMember | null>(null);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantPermission, setGrantPermission] = useState<SpecialPermission | "">(
    "",
  );
  const [grantExpiresAt, setGrantExpiresAt] = useState("");

  const membersQuery = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => projectService.listMembers(projectId),
  });
  const invitationsQuery = useQuery({
    queryKey: ["project-invitations", projectId],
    queryFn: () => projectService.listInvitations(projectId),
  });
  const grantsQuery = useQuery({
    queryKey: ["project-permission-grants", projectId],
    queryFn: () => projectService.listPermissionGrants(projectId),
  });
  const catalogQuery = useQuery({
    queryKey: ["authorization", "catalog"],
    queryFn: () => authorizationService.catalog(),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project-members", projectId] });
    qc.invalidateQueries({ queryKey: ["project-invitations", projectId] });
    qc.invalidateQueries({ queryKey: ["project-permission-grants", projectId] });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
  };

  const inviteMutation = useMutation({
    mutationFn: () =>
      projectService.inviteMember(projectId, {
        email,
        role: inviteRole,
        expiresInDays,
      }),
    onSuccess: (result) => {
      toast.show("success", "Invitation créée");
      setOneTimeToken(result.token);
      setEmail("");
      invalidate();
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const resendMutation = useMutation({
    mutationFn: (invitationId: string) =>
      projectService.resendInvitation(projectId, invitationId),
    onSuccess: (result) => {
      setOneTimeToken(result.token);
      toast.show("success", "Invitation renvoyée");
      invalidate();
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const revokeInvitationMutation = useMutation({
    mutationFn: (invitationId: string) =>
      projectService.revokeInvitation(projectId, invitationId),
    onSuccess: () => {
      toast.show("success", "Invitation révoquée");
      invalidate();
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: ProjectRole }) =>
      projectService.updateMemberRole(projectId, memberId, role),
    onSuccess: () => {
      toast.show("success", "Rôle mis à jour");
      invalidate();
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) =>
      projectService.removeMember(projectId, memberId),
    onSuccess: () => {
      toast.show("success", "Membre retiré");
      setRemoveTarget(null);
      invalidate();
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const grantMutation = useMutation({
    mutationFn: () =>
      projectService.grantPermission(projectId, {
        userId: grantUserId,
        permission: grantPermission as SpecialPermission,
        expiresAt: grantExpiresAt
          ? new Date(grantExpiresAt).toISOString()
          : null,
      }),
    onSuccess: () => {
      toast.show("success", "Permission spéciale attribuée");
      setGrantUserId("");
      setGrantPermission("");
      setGrantExpiresAt("");
      invalidate();
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const revokeGrantMutation = useMutation({
    mutationFn: (grantId: string) =>
      projectService.revokePermission(projectId, grantId),
    onSuccess: () => {
      toast.show("success", "Permission révoquée");
      invalidate();
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const members = membersQuery.data ?? [];
  const invitations = invitationsQuery.data ?? [];
  const grants = grantsQuery.data ?? [];
  const projectSpecialPermissions = useMemo(
    () =>
      catalogQuery.data?.specialPermissions.filter(
        (item) => item.scope === "PROJECT" || item.scope === "BOTH",
      ) ?? [],
    [catalogQuery.data],
  );
  const assignableRoles = useMemo(
    () =>
      Object.entries(PROJECT_ROLE_LABELS).filter(
        ([role]) => canAssignOwner || role !== "OWNER",
      ),
    [canAssignOwner],
  );

  const copyToken = async () => {
    if (!oneTimeToken) return;
    try {
      await navigator.clipboard.writeText(oneTimeToken);
      toast.show("success", "Jeton copié");
    } catch {
      toast.show("error", "Copie impossible");
    }
  };

  if (membersQuery.isLoading) {
    return <Skeleton className="h-64 rounded-2xl" />;
  }

  if (membersQuery.isError) {
    return (
      <ErrorState
        title="Impossible de charger les membres"
        description={
          membersQuery.error instanceof Error
            ? membersQuery.error.message
            : undefined
        }
        onRetry={() => membersQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      {oneTimeToken && (
        <Card className="rounded-2xl border-amber-500/40">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">Jeton d'invitation à usage unique</h3>
                <p className="text-xs text-muted">
                  Transmettez-le par un canal sûr. Il ne sera plus affiché après
                  fermeture.
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOneTimeToken(null)}
                title="Masquer"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex gap-2">
              <Input readOnly value={oneTimeToken} className="font-mono text-xs" />
              <Button variant="outline" onClick={copyToken} className="gap-2">
                <Copy className="h-4 w-4" /> Copier
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold">
              <Shield className="h-4 w-4" /> Membres ({members.length})
            </h2>
            <span className="text-xs text-muted">
              {canManageMembers
                ? "Vous pouvez gérer les membres et leurs droits."
                : "Lecture seule"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs text-muted">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">Utilisateur</th>
                  <th className="px-2 py-2 text-left font-medium">Rôle projet</th>
                  <th className="px-2 py-2 text-left font-medium">
                    Permissions spéciales
                  </th>
                  <th className="px-2 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr
                    key={member.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-2 py-3">
                      <div className="font-medium">
                        {member.user.name ?? member.user.email}
                      </div>
                      <div className="font-mono text-[11px] text-muted">
                        {member.user.email}
                      </div>
                      <div className="text-[10px] text-muted">
                        {member.status === "ACTIVE"
                          ? "Actif"
                          : member.status === "SUSPENDED"
                            ? "Suspendu"
                            : "Retiré"}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {canManageMembers ? (
                        <Select
                          value={member.role}
                          onChange={(e) =>
                            updateRoleMutation.mutate({
                              memberId: member.id,
                              role: e.target.value as ProjectRole,
                            })
                          }
                          disabled={
                            updateRoleMutation.isPending ||
                            (member.role === "OWNER" && !canAssignOwner)
                          }
                        >
                          {assignableRoles.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        PROJECT_ROLE_LABELS[member.role]
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(member.specialPermissions ?? []).length === 0 && (
                          <span className="text-xs text-muted">—</span>
                        )}
                        {(member.specialPermissions ?? []).map((grant) => (
                          <span
                            key={grant.id}
                            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
                            title={
                              grant.expiresAt
                                ? `Expire le ${formatDate(grant.expiresAt)}`
                                : "Sans expiration"
                            }
                          >
                            {grant.permission}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right">
                      {canManageMembers && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:bg-red-500/10"
                          onClick={() => setRemoveTarget(member)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {canManageMembers && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl">
            <CardContent className="space-y-3 p-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <UserPlus className="h-4 w-4" /> Inviter un membre
              </h2>
              <Input
                type="email"
                placeholder="email@exemple.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as ProjectRole)}
                >
                  {assignableRoles.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Select
                  value={String(expiresInDays)}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                >
                  <option value="1">1 jour</option>
                  <option value="7">7 jours</option>
                  <option value="14">14 jours</option>
                  <option value="30">30 jours</option>
                </Select>
              </div>
              <Button
                className="w-full gap-2"
                disabled={!email}
                loading={inviteMutation.isPending}
                onClick={() => inviteMutation.mutate()}
              >
                <Mail className="h-4 w-4" /> Créer l'invitation
              </Button>

              <div className="border-t border-border/60 pt-3">
                <h3 className="mb-2 text-xs font-medium text-muted">
                  Invitations en attente ({invitations.length})
                </h3>
                {invitations.length === 0 ? (
                  <p className="text-xs text-muted">Aucune invitation en attente.</p>
                ) : (
                  <div className="space-y-2">
                    {invitations.map((invitation) => (
                      <div
                        key={invitation.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-xs"
                      >
                        <div>
                          <div className="font-mono">{invitation.email}</div>
                          <div className="text-muted">
                            {PROJECT_ROLE_LABELS[invitation.role]} · expire le{" "}
                            {formatDate(invitation.expiresAt)}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Renvoyer"
                            onClick={() => resendMutation.mutate(invitation.id)}
                            loading={resendMutation.isPending}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500"
                            title="Révoquer"
                            onClick={() =>
                              revokeInvitationMutation.mutate(invitation.id)
                            }
                            loading={revokeInvitationMutation.isPending}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="space-y-3 p-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <Plus className="h-4 w-4" /> Permission spéciale
              </h2>
              <Select
                value={grantUserId}
                onChange={(e) => setGrantUserId(e.target.value)}
              >
                <option value="">Choisir un membre</option>
                {members
                  .filter((member) => member.status === "ACTIVE")
                  .map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.user.name ?? member.user.email}
                    </option>
                  ))}
              </Select>
              <Select
                value={grantPermission}
                onChange={(e) =>
                  setGrantPermission(e.target.value as SpecialPermission | "")
                }
              >
                <option value="">Choisir une permission</option>
                {projectSpecialPermissions.map((item) => (
                  <option key={item.permission} value={item.permission}>
                    {item.label}
                  </option>
                ))}
              </Select>
              <Input
                type="datetime-local"
                value={grantExpiresAt}
                onChange={(e) => setGrantExpiresAt(e.target.value)}
                title="Expiration optionnelle"
              />
              <Button
                className="w-full gap-2"
                disabled={!grantUserId || !grantPermission}
                loading={grantMutation.isPending}
                onClick={() => grantMutation.mutate()}
              >
                <Shield className="h-4 w-4" /> Attribuer
              </Button>

              <div className="border-t border-border/60 pt-3">
                <h3 className="mb-2 text-xs font-medium text-muted">
                  Permissions actives ({grants.length})
                </h3>
                {grants.length === 0 ? (
                  <p className="text-xs text-muted">
                    Aucune permission spéciale sur ce projet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {grants.map((grant) => (
                      <div
                        key={grant.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-xs"
                      >
                        <div>
                          <div className="font-medium">
                            {grant.user.name ?? grant.user.email}
                          </div>
                          <div className="text-muted">
                            {grant.permission} ·{" "}
                            {grant.expiresAt
                              ? `expire le ${formatDate(grant.expiresAt)}`
                              : "sans expiration"}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500"
                          title="Révoquer"
                          onClick={() => revokeGrantMutation.mutate(grant.id)}
                          loading={revokeGrantMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={!!removeTarget}
        title="Retirer ce membre ?"
        description={
          removeTarget
            ? `${removeTarget.user.email} perdra immédiatement l'accès au projet. Le dernier OWNER ne peut pas être retiré.`
            : ""
        }
        confirmLabel="Retirer"
        danger
        loading={removeMutation.isPending}
        onConfirm={() => {
          if (!removeTarget) return;
          removeMutation.mutate(removeTarget.id);
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
