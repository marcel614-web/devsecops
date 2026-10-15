import { useState } from "react";
import { Users, Plus, Pencil, UserX } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import { userService, type ApiUser } from "@/services/user.service";
import { getErrorMessage } from "@/services/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type FormState = {
  id?: string;
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "DEVELOPER";
};

const emptyForm: FormState = { name: "", email: "", password: "", role: "DEVELOPER" };

export function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["users"],
    queryFn: () => userService.list({ pageSize: 100 }),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deactivateTarget, setDeactivateTarget] = useState<ApiUser | null>(null);

  const createMutation = useMutation({
    mutationFn: (d: FormState) =>
      userService.create({ name: d.name, email: d.email, password: d.password, role: d.role }),
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
      userService.update(d.id!, { name: d.name, email: d.email, role: d.role }),
    onSuccess: () => {
      toast.show("success", "Utilisateur mis à jour");
      qc.invalidateQueries({ queryKey: ["users"] });
      setFormOpen(false);
      setForm(emptyForm);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => userService.deactivate(id),
    onSuccess: () => {
      toast.show("success", "Utilisateur désactivé");
      qc.invalidateQueries({ queryKey: ["users"] });
      setDeactivateTarget(null);
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const items = data?.items ?? [];

  const openCreate = () => {
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (u: ApiUser) => {
    setForm({ id: u.id, name: u.name ?? "", email: u.email, password: "", role: u.role });
    setFormOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.id) updateMutation.mutate(form);
    else createMutation.mutate(form);
  };

  return (
    <div>
      <PageHeader
        title="Utilisateurs"
        description="Gestion des comptes utilisateurs"
        actions={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" /> Nouvel utilisateur
          </Button>
        }
      />

      {isLoading && (
        <Card>
          <CardContent className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
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
        <EmptyState icon={Users} title="Aucun utilisateur" description="Créez votre premier utilisateur." />
      )}

      {!isLoading && !isError && items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-muted border-b border-border">
                <tr>
                  <th className="text-left py-2 px-4 font-medium">Nom</th>
                  <th className="text-left py-2 px-4 font-medium">Email</th>
                  <th className="text-left py-2 px-4 font-medium">Rôle</th>
                  <th className="text-left py-2 px-4 font-medium">Statut</th>
                  <th className="text-right py-2 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 px-4">{u.name ?? "—"}</td>
                    <td className="py-2.5 px-4 font-mono text-xs">{u.email}</td>
                    <td className="py-2.5 px-4">{u.role}</td>
                    <td className="py-2.5 px-4">{u.isActive ? "Actif" : "Désactivé"}</td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" title="Modifier" onClick={() => openEdit(u)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Désactiver" onClick={() => setDeactivateTarget(u)}>
                          <UserX className="w-4 h-4" />
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
          <Card className="w-full max-w-md">
            <CardContent className="space-y-4 py-4">
              <h3 className="font-semibold text-base">
                {form.id ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
              </h3>
              <form onSubmit={submit} className="space-y-3">
                <input
                  className="w-full px-3 py-2 rounded border border-border bg-background"
                  placeholder="Nom"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
                <input
                  className="w-full px-3 py-2 rounded border border-border bg-background"
                  placeholder="Email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
                {!form.id && (
                  <input
                    className="w-full px-3 py-2 rounded border border-border bg-background"
                    placeholder="Mot de passe"
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required
                  />
                )}
                <select
                  className="w-full px-3 py-2 rounded border border-border bg-background"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "ADMIN" | "DEVELOPER" }))}
                >
                  <option value="DEVELOPER">DEVELOPER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
                    Annuler
                  </Button>
                  <Button type="submit" loading={createMutation.isPending || updateMutation.isPending}>
                    {form.id ? "Enregistrer" : "Créer"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={!!deactivateTarget}
        title="Désactiver cet utilisateur ?"
        description={deactivateTarget ? `${deactivateTarget.email} sera désactivé.` : ""}
        confirmLabel="Désactiver"
        danger
        loading={deactivateMutation.isPending}
        onConfirm={() => {
          if (!deactivateTarget) return;
          deactivateMutation.mutate(deactivateTarget.id);
        }}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}