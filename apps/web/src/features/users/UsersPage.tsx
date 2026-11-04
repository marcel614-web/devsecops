import { useState } from "react";
import {
  Users,
  Plus,
  Pencil,
  UserX,
  UserCheck,
  Shield,
  Search,
  Trash2,
  Eye,
  EyeOff,
  KeyRound,
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
import { useToast } from "@/components/feedback/Toast";
import { userService, type ApiUser } from "@/services/user.service";
import { getErrorMessage } from "@/services/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/authStore";
import type { Role, UserStatus } from "@/types/api";

type FormState = {
  id?: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  status: UserStatus;
};

const emptyForm: FormState = {
  name: "",
  email: "",
  password: "",
  role: "PLATFORM_USER",
  status: "ACTIVE",
};

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: "Administrateur plateforme",
  PLATFORM_USER: "Utilisateur plateforme",
  ADMIN: "Administrateur (historique)",
  DEVELOPER: "Développeur (historique)",
};

const STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: "Actif",
  SUSPENDED: "Suspendu",
  PENDING: "En attente",
  DISABLED: "Désactivé",
};

function initials(name?: string | null) {
  return (name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function isPlatformAdmin(role: string | undefined) {
  return role === "PLATFORM_ADMIN" || role === "ADMIN";
}

export function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: currentUser } = useAuthStore();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["users", appliedSearch, roleFilter, statusFilter],
    queryFn: () =>
      userService.list({
        pageSize: 100,
        search: appliedSearch || undefined,
        role: roleFilter || undefined,
        status: (statusFilter || undefined) as UserStatus | undefined,
      }),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [suspendTarget, setSuspendTarget] = useState<ApiUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiUser | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const createMutation = useMutation({
    mutationFn: (d: FormState) =>
      userService.create({
        name: d.name,
        email: d.email,
        password: d.password,
        role: d.role,
        status: d.status,
      }),
    onSuccess: () => {
      toast.show("success", "Utilisateur créé");
      qc.invalidateQueries({ queryKey: ["users"] });
      setFormOpen(false);
      setForm(emptyForm);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (d: FormState) =>
      userService.update(d.id!, {
        name: d.name,
        email: d.email,
        role: d.role,
        status: d.status,
        ...(d.password ? { password: d.password } : {}),
      }),
    onSuccess: () => {
      toast.show("success", "Utilisateur mis à jour");
      qc.invalidateQueries({ queryKey: ["users"] });
      setFormOpen(false);
      setForm(emptyForm);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const suspendMutation = useMutation({
    mutationFn: (id: string) => userService.suspend(id),
    onSuccess: () => {
      toast.show("success", "Utilisateur suspendu");
      qc.invalidateQueries({ queryKey: ["users"] });
      setSuspendTarget(null);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => userService.reactivate(id),
    onSuccess: () => {
      toast.show("success", "Utilisateur réactivé");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => userService.revokeSessions(id),
    onSuccess: () => toast.show("success", "Sessions révoquées"),
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => userService.delete(id),
    onSuccess: () => {
      toast.show("success", "Utilisateur désactivé");
      qc.invalidateQueries({ queryKey: ["users"] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const items = data?.items ?? [];

  const openCreate = () => {
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (u: ApiUser) => {
    setForm({
      id: u.id,
      name: u.name ?? "",
      email: u.email,
      password: "",
      role: u.role,
      status: u.status,
    });
    setFormOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.id) updateMutation.mutate(form);
    else createMutation.mutate(form);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Utilisateurs"
        description="Gestion des comptes, des rôles globaux et des statuts"
        actions={
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" /> Nouvel utilisateur
          </Button>
        }
      />

      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3 text-sm text-muted">
            <Search className="w-4 h-4" />
            Filtres
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un nom ou email…"
            />
            <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">Tous les rôles</option>
              <option value="PLATFORM_ADMIN">Administrateur plateforme</option>
              <option value="PLATFORM_USER">Utilisateur plateforme</option>
            </Select>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Tous les statuts</option>
              <option value="ACTIVE">Actif</option>
              <option value="SUSPENDED">Suspendu</option>
              <option value="PENDING">En attente</option>
              <option value="DISABLED">Désactivé</option>
            </Select>
            <Button variant="outline" onClick={() => setAppliedSearch(search)}>
              Appliquer
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <Card>
          <CardContent className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </CardContent>
        </Card>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les utilisateurs"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={Users}
          title="Aucun utilisateur"
          description="Créez votre premier utilisateur."
        />
      )}

      {!isLoading && !isError && items.length > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted border-b border-border bg-slate-50/60 dark:bg-slate-800/40">
                <tr>
                  <th className="text-left py-3 px-4 font-medium">Utilisateur</th>
                  <th className="text-left py-3 px-4 font-medium">Email</th>
                  <th className="text-left py-3 px-4 font-medium">Rôle global</th>
                  <th className="text-left py-3 px-4 font-medium">Statut</th>
                  <th className="text-right py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-border/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary-600/15 text-primary-600 dark:text-primary-400 flex items-center justify-center text-xs font-bold">
                          {initials(u.name)}
                        </div>
                        <div>
                          <div className="font-medium">{u.name ?? "—"}</div>
                          <div className="text-[11px] text-muted">
                            {u._count?.projectMemberships ?? 0} projet(s)
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-muted">
                      {u.email}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${
                          isPlatformAdmin(u.role)
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-slate-200/70 dark:bg-slate-700/60 text-muted"
                        }`}
                      >
                        {isPlatformAdmin(u.role) && (
                          <Shield className="w-3 h-3 inline mr-1" />
                        )}
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${
                          u.status === "ACTIVE"
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : u.status === "SUSPENDED"
                              ? "bg-red-500/15 text-red-600 dark:text-red-400"
                              : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {STATUS_LABELS[u.status] ?? u.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Modifier"
                          onClick={() => openEdit(u)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Révoquer les sessions"
                          onClick={() => revokeMutation.mutate(u.id)}
                          loading={revokeMutation.isPending}
                        >
                          <KeyRound className="w-4 h-4" />
                        </Button>
                        {u.status === "ACTIVE" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 hover:bg-red-500/10"
                            title={
                              u.id === currentUser?.id
                                ? "Impossible de suspendre votre propre compte"
                                : "Suspendre"
                            }
                            onClick={() => setSuspendTarget(u)}
                            disabled={u.id === currentUser?.id}
                          >
                            <UserX className="w-4 h-4" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-emerald-600 hover:bg-emerald-500/10"
                            title="Réactiver"
                            onClick={() => reactivateMutation.mutate(u.id)}
                            loading={reactivateMutation.isPending}
                          >
                            <UserCheck className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:bg-red-500/10"
                          title="Désactiver définitivement"
                          onClick={() => setDeleteTarget(u)}
                          disabled={u.id === currentUser?.id}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md rounded-3xl">
            <CardContent className="space-y-4 py-5">
              <h3 className="font-semibold text-lg">
                {form.id ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
              </h3>
              <form onSubmit={submit} className="space-y-3">
                <Input
                  placeholder="Nom"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  required
                />
                <Input
                  placeholder="Email"
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                  required
                />
                <div className="relative">
                  <Input
                    placeholder={
                      form.id
                        ? "Nouveau mot de passe (laisser vide pour conserver)"
                        : "Mot de passe"
                    }
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, password: e.target.value }))
                    }
                    required={!form.id}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                    onClick={() => setShowPassword((p) => !p)}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <Select
                  value={form.role}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, role: e.target.value as Role }))
                  }
                >
                  <option value="PLATFORM_USER">Utilisateur plateforme</option>
                  <option value="PLATFORM_ADMIN">Administrateur plateforme</option>
                </Select>
                <Select
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      status: e.target.value as UserStatus,
                    }))
                  }
                >
                  <option value="ACTIVE">Actif</option>
                  <option value="PENDING">En attente</option>
                  <option value="SUSPENDED">Suspendu</option>
                  <option value="DISABLED">Désactivé</option>
                </Select>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setFormOpen(false)}
                  >
                    Annuler
                  </Button>
                  <Button
                    type="submit"
                    loading={createMutation.isPending || updateMutation.isPending}
                  >
                    {form.id ? "Enregistrer" : "Créer"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={!!suspendTarget}
        title="Suspendre cet utilisateur ?"
        description={
          suspendTarget
            ? `${suspendTarget.email} ne pourra plus se connecter et ses sessions seront révoquées.`
            : ""
        }
        confirmLabel="Suspendre"
        danger
        loading={suspendMutation.isPending}
        onConfirm={() => {
          if (!suspendTarget) return;
          suspendMutation.mutate(suspendTarget.id);
        }}
        onCancel={() => setSuspendTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Désactiver définitivement cet utilisateur ?"
        description={
          deleteTarget
            ? `Le compte ${deleteTarget.email} sera désactivé logiquement. Les projets, pipelines et audits sont conservés.`
            : ""
        }
        confirmLabel="Désactiver"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
