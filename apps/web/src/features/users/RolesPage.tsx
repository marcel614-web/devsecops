import { useMemo, useState } from "react";
import { ShieldCheck, Plus, Trash2, KeyRound } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/feedback/ErrorState";
import { useToast } from "@/components/feedback/Toast";
import { authorizationService } from "@/services/authorization.service";
import { userService } from "@/services/user.service";
import { getErrorMessage } from "@/services/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SpecialPermission } from "@/types/api";

function permissionLabel(permission: string) {
  return permission
    .split(":")
    .map((part) => part.replace(/_/g, " "))
    .join(" · ");
}

export function RolesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [userId, setUserId] = useState("");
  const [permission, setPermission] = useState<SpecialPermission | "">("");
  const [expiresAt, setExpiresAt] = useState("");

  const catalogQuery = useQuery({
    queryKey: ["authorization", "catalog"],
    queryFn: () => authorizationService.catalog(),
  });
  const grantsQuery = useQuery({
    queryKey: ["authorization", "global-grants"],
    queryFn: () => authorizationService.globalGrants(),
  });
  const usersQuery = useQuery({
    queryKey: ["users", "roles-page"],
    queryFn: () => userService.list({ pageSize: 100 }),
  });

  const grantMutation = useMutation({
    mutationFn: () =>
      authorizationService.grantGlobal({
        userId,
        permission: permission as SpecialPermission,
        scopeType: "GLOBAL",
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      }),
    onSuccess: () => {
      toast.show("success", "Permission globale attribuée");
      qc.invalidateQueries({ queryKey: ["authorization", "global-grants"] });
      setUserId("");
      setPermission("");
      setExpiresAt("");
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const revokeMutation = useMutation({
    mutationFn: (grantId: string) => authorizationService.revokeGlobal(grantId),
    onSuccess: () => {
      toast.show("success", "Permission révoquée");
      qc.invalidateQueries({ queryKey: ["authorization", "global-grants"] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const catalog = catalogQuery.data;
  const globalGrants = grantsQuery.data ?? [];
  const users = usersQuery.data?.items ?? [];

  const globalOnlyPermissions = useMemo(
    () =>
      catalog?.specialPermissions.filter(
        (item) => item.scope === "GLOBAL" || item.scope === "BOTH",
      ) ?? [],
    [catalog],
  );

  if (catalogQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (catalogQuery.isError || !catalog) {
    return (
      <ErrorState
        title="Impossible de charger la matrice des permissions"
        description={
          catalogQuery.error instanceof Error
            ? catalogQuery.error.message
            : undefined
        }
        onRetry={() => catalogQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rôles et permissions"
        description="Matrice centrale des droits globaux et par projet. Le backend reste la source de vérité."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4" /> Rôles globaux
            </h2>
            <div className="space-y-2 text-sm">
              {catalog.globalRoles.map((role) => (
                <div
                  key={role.role}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="font-medium">{role.label}</div>
                  <div className="mt-1 text-xs text-muted">{role.role}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {role.permissions.map((permission) => (
                      <span
                        key={permission}
                        className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] dark:bg-slate-700/60"
                      >
                        {permission}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <KeyRound className="h-4 w-4" /> Permissions spéciales
            </h2>
            <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1 text-sm">
              {catalog.specialPermissions.map((item) => (
                <div
                  key={item.permission}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.label}</span>
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                      {item.scope}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{item.description}</p>
                  <div className="mt-2 text-[10px] text-muted">
                    {item.capabilities.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <h2 className="mb-3 font-semibold">Matrice des rôles projet</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left font-medium">Permission</th>
                  {catalog.projectRoles.map((role) => (
                    <th
                      key={role.role}
                      className="px-2 py-2 text-center font-medium"
                      title={role.label}
                    >
                      {role.role}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catalog.permissions.map((permission) => (
                  <tr
                    key={permission}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-2 py-1.5 font-mono text-[10px]">
                      {permissionLabel(permission)}
                    </td>
                    {catalog.projectRoles.map((role) => (
                      <td
                        key={`${role.role}-${permission}`}
                        className="px-2 py-1.5 text-center"
                      >
                        {role.permissions.includes(permission) ? (
                          <span className="text-emerald-600">✓</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <h2 className="mb-3 font-semibold">Attributions globales</h2>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choisir un utilisateur</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name ?? user.email} ({user.email})
                </option>
              ))}
            </Select>
            <Select
              value={permission}
              onChange={(e) =>
                setPermission(e.target.value as SpecialPermission | "")
              }
            >
              <option value="">Choisir une permission</option>
              {globalOnlyPermissions.map((item) => (
                <option key={item.permission} value={item.permission}>
                  {item.label}
                </option>
              ))}
            </Select>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              title="Expiration optionnelle"
            />
            <Button
              className="gap-2"
              disabled={!userId || !permission}
              loading={grantMutation.isPending}
              onClick={() => grantMutation.mutate()}
            >
              <Plus className="h-4 w-4" /> Attribuer
            </Button>
          </div>

          {grantsQuery.isLoading ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : globalGrants.length === 0 ? (
            <p className="text-sm text-muted">Aucune permission globale active.</p>
          ) : (
            <div className="space-y-2">
              {globalGrants.map((grant) => (
                <div
                  key={grant.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                >
                  <div>
                    <div className="font-medium">
                      {grant.user.name ?? grant.user.email} · {grant.permission}
                    </div>
                    <div className="text-xs text-muted">
                      {grant.expiresAt
                        ? `Expire le ${new Date(grant.expiresAt).toLocaleString()}`
                        : "Sans expiration"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-500 hover:bg-red-500/10"
                    onClick={() => revokeMutation.mutate(grant.id)}
                    loading={revokeMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" /> Révoquer
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
