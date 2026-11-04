import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Clock,
  KeyRound,
  LogIn,
  LogOut,
  Monitor,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Tabs } from "@/components/ui/Tabs";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { UserStatusBadge } from "@/components/ui/UserBadge";
import { useToast } from "@/components/feedback/Toast";
import { SettingsPageHeader } from "./SettingsPageHeader";
import { authService } from "@/services/auth.service";
import { auditService } from "@/services/audit.service";
import { getErrorMessage } from "@/services/api";
import { useAuthStore } from "@/stores/authStore";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import type { AuditLog } from "@/types/api";

type AuditCategory = "all" | "auth" | "security";

const AUDIT_TABS = [
  { key: "all", label: "Tout" },
  { key: "auth", label: "Connexions" },
  { key: "security", label: "Sécurité" },
];

type ActionMeta = {
  label: string;
  icon: LucideIcon;
  tone: string;
};

const DEFAULT_ACTION: ActionMeta = {
  label: "Action sur le compte",
  icon: Activity,
  tone: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};

function getActionMeta(action: string): ActionMeta {
  if (/LOGIN_FAILED|FAILED.*LOGIN|LOGIN.*FAILED/i.test(action)) {
    return {
      label: "Échec de connexion",
      icon: AlertTriangle,
      tone: "bg-red-500/15 text-red-600 dark:text-red-300",
    };
  }
  if (/SESSIONS?_REVOKED|REVOKE.*SESSION/i.test(action)) {
    return {
      label: "Sessions révoquées",
      icon: LogOut,
      tone: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
    };
  }
  if (/PASSWORD/i.test(action)) {
    return {
      label: "Mot de passe modifié",
      icon: KeyRound,
      tone: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    };
  }
  if (/LOGIN|SIGNIN|AUTH/i.test(action)) {
    return {
      label: "Connexion réussie",
      icon: LogIn,
      tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    };
  }
  if (/LOGOUT|SIGNOUT/i.test(action)) {
    return {
      label: "Déconnexion",
      icon: LogOut,
      tone: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
    };
  }
  if (/PROFILE|UPDATE|EDIT|MODIFY/i.test(action)) {
    return {
      label: "Profil mis à jour",
      icon: User,
      tone: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
    };
  }
  if (/SECURITY|SCAN|VULN/i.test(action)) {
    return {
      label: "Événement de sécurité",
      icon: ShieldAlert,
      tone: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
    };
  }
  return DEFAULT_ACTION;
}

export function SecurityPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user: storedUser, logout } = useAuthStore();
  const [category, setCategory] = useState<AuditCategory>("all");
  const [page, setPage] = useState(1);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const { data: me, isLoading: isMeLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => authService.me(),
    initialData: storedUser ?? undefined,
  });

  const currentUser = me ?? storedUser;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["my-audit", currentUser?.id, category, page],
    queryFn: () =>
      auditService.list({
        page,
        pageSize: 10,
        category: category === "all" ? undefined : category,
      }),
    enabled: !!currentUser?.id,
    refetchInterval: 30_000,
  });

  const revokeMutation = useMutation({
    mutationFn: () => authService.revokeAllSessions(),
    onSuccess: async () => {
      setRevokeOpen(false);
      toast.show("success", "Toutes les sessions ont été révoquées.");
      // Le jeton courant est désormais invalide : on termine proprement la
      // session locale avant de renvoyer vers la connexion.
      await authService.logout().catch(() => undefined);
      logout();
      navigate("/login", { replace: true });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const items = (data?.items ?? []) as AuditLog[];

  const onCategoryChange = (key: string) => {
    setCategory(key as AuditCategory);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Sécurité"
        description="Sessions, mot de passe et historique de connexion"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw
              className={cn("h-4 w-4", isFetching && "animate-spin")}
            />
            Actualiser
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardContent className="flex items-start gap-3 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-300">
              <Clock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-muted">Dernière connexion</p>
              <p className="mt-0.5 text-sm font-semibold">
                {isMeLoading ? "…" : timeAgo(currentUser?.lastLoginAt)}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted">
                {formatDate(currentUser?.lastLoginAt)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-start gap-3 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-muted">Statut du compte</p>
              <div className="mt-1">
                <UserStatusBadge
                  status={currentUser?.status}
                  isActive={currentUser?.isActive}
                />
              </div>
              <p className="mt-1 text-xs text-muted">
                Les contrôles d'accès sont vérifiés à chaque requête.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-start gap-3 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-300">
              <Monitor className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-muted">Session actuelle</p>
              <p className="mt-0.5 text-sm font-semibold">Navigateur web</p>
              <p className="mt-0.5 text-xs text-muted">
                Jeton d'accès 15 min · refresh 7 jours
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Historique d'activité
            </CardTitle>
            <p className="mt-1 text-xs text-muted">
              Les connexions, changements de mot de passe et actions sensibles
              de votre compte.
            </p>
          </div>
          <Tabs
            tabs={AUDIT_TABS}
            active={category}
            onChange={onCategoryChange}
            className="border-0"
          />
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-16" />
              ))}
            </div>
          )}

          {isError && (
            <ErrorState
              title="Impossible de charger l'historique"
              description={error instanceof Error ? error.message : undefined}
              onRetry={() => refetch()}
            />
          )}

          {!isLoading && !isError && items.length === 0 && (
            <EmptyState
              title="Aucune activité"
              description="Les connexions et actions sensibles apparaîtront ici."
            />
          )}

          {!isLoading && !isError && items.length > 0 && (
            <>
              <ol className="relative space-y-4 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-border">
                {items.map((entry) => {
                  const meta = getActionMeta(entry.action);
                  const Icon = meta.icon;
                  return (
                    <li key={entry.id} className="relative flex gap-3">
                      <div
                        className={cn(
                          "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-4 border-surface",
                          meta.tone,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1 rounded-lg border border-border bg-panel/40 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">{meta.label}</p>
                          <span className="text-xs text-muted">
                            {timeAgo(entry.createdAt)}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] text-muted">
                          {entry.action}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {formatDate(entry.createdAt)}
                          </span>
                          {entry.ip && (
                            <span className="inline-flex items-center gap-1">
                              <Monitor className="h-3.5 w-3.5" />
                              {entry.ip}
                            </span>
                          )}
                          {entry.userAgent && (
                            <span
                              className="max-w-full truncate"
                              title={entry.userAgent}
                            >
                              {entry.userAgent}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <Pagination
                page={data?.page ?? page}
                totalPages={data?.totalPages ?? 1}
                onPage={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-red-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" />
            Zone sensible
          </CardTitle>
          <p className="mt-1 text-xs text-muted">
            En cas de doute sur la sécurité de votre compte, révoquez toutes les
            sessions actives.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Révoquer toutes les sessions</p>
            <p className="mt-0.5 text-xs text-muted">
              Vous serez déconnecté de tous les appareils, y compris celui-ci.
            </p>
          </div>
          <Button
            variant="danger"
            onClick={() => setRevokeOpen(true)}
            disabled={revokeMutation.isPending}
          >
            <LogOut className="h-4 w-4" />
            Révoquer les sessions
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={revokeOpen}
        title="Révoquer toutes les sessions ?"
        description="Tous les jetons d'accès et de rafraîchissement seront invalidés. Vous devrez vous reconnecter sur chaque appareil."
        confirmLabel="Révoquer"
        danger
        loading={revokeMutation.isPending}
        onConfirm={() => revokeMutation.mutate()}
        onCancel={() => setRevokeOpen(false)}
      />
    </div>
  );
}
