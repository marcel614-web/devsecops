// apps/web/src/features/settings/SettingsPage.tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  ChevronRight,
  Clock,
  Github,
  Palette,
  Search,
  Server,
  Shield,
  ShieldCheck,
  ScrollText,
  User,
  Users,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { UserRoleBadge, UserStatusBadge, initials } from "@/components/ui/UserBadge";
import { EmptyState } from "@/components/feedback/EmptyState";
import { useAuthStore } from "@/stores/authStore";
import { isPlatformAdminRole } from "@/lib/roles";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { cn, timeAgo } from "@/lib/utils";

type SettingsGroupKey = "account" | "preferences" | "integrations" | "administration";

interface SettingsItem {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
  group: SettingsGroupKey;
  accent: string;
  adminOnly?: boolean;
  permission?: string;
}

const SETTINGS_GROUPS: Array<{
  key: SettingsGroupKey;
  title: string;
  description: string;
}> = [
  {
    key: "account",
    title: "Mon compte",
    description: "Votre identité et la sécurité de votre compte",
  },
  {
    key: "preferences",
    title: "Préférences",
    description: "Personnalisez votre expérience sur la plateforme",
  },
  {
    key: "integrations",
    title: "Intégrations",
    description: "Connexions aux services externes de la plateforme",
  },
  {
    key: "administration",
    title: "Administration",
    description: "Gestion des accès et traçabilité des actions",
  },
];

const SETTINGS_ITEMS: SettingsItem[] = [
  {
    to: "/settings/profile",
    icon: User,
    title: "Profil et identité",
    description: "Nom, adresse email et informations du compte",
    group: "account",
    accent: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  },
  {
    to: "/settings/security",
    icon: Shield,
    title: "Sécurité",
    description: "Sessions, mot de passe et historique de connexion",
    group: "account",
    accent: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  },
  {
    to: "/settings/notifications",
    icon: Bell,
    title: "Notifications",
    description: "Choisir les alertes à mettre en avant dans l'interface",
    group: "preferences",
    accent: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  },
  {
    to: "/settings/appearance",
    icon: Palette,
    title: "Apparence",
    description: "Thème clair ou sombre et aperçu de l'interface",
    group: "preferences",
    accent: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  },
  {
    to: "/settings/servers",
    icon: Server,
    title: "Serveur par défaut",
    description: "Conserver un serveur de déploiement favori",
    group: "preferences",
    accent: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  },
  {
    to: "/settings/github",
    icon: Github,
    title: "GitHub App",
    description: "Identifiants, webhook et déclenchement automatique",
    group: "integrations",
    accent: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
    adminOnly: true,
  },
  {
    to: "/settings/defectdojo",
    icon: Shield,
    title: "DefectDojo",
    description: "Export optionnel des résultats d'analyse",
    group: "integrations",
    accent: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
    adminOnly: true,
  },
  {
    to: "/users",
    icon: Users,
    title: "Utilisateurs",
    description: "Comptes, rôles globaux et statuts",
    group: "administration",
    accent: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
    adminOnly: true,
  },
  {
    to: "/roles",
    icon: ShieldCheck,
    title: "Rôles et permissions",
    description: "Matrice RBAC et permissions spéciales",
    group: "administration",
    accent: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300",
    adminOnly: true,
  },
  {
    to: "/audit-logs",
    icon: ScrollText,
    title: "Journal d'audit",
    description: "Actions sensibles et refus d'accès",
    group: "administration",
    accent: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
    permission: "audit_log:read",
  },
];

export function SettingsPage() {
  const { user } = useAuthStore();
  const { data: unreadData } = useUnreadNotificationCount();
  const unreadCount = unreadData?.count ?? 0;
  const [query, setQuery] = useState("");

  const isAdmin = isPlatformAdminRole(user?.role);

  const visibleItems = useMemo(
    () =>
      SETTINGS_ITEMS.filter((item) => {
        if (item.adminOnly && !isAdmin) return false;
        if (
          item.permission &&
          !isAdmin &&
          !user?.globalPermissions?.includes(item.permission)
        ) {
          return false;
        }
        return true;
      }),
    [isAdmin, user?.globalPermissions],
  );

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return visibleItems;
    return visibleItems.filter((item) =>
      `${item.title} ${item.description}`.toLowerCase().includes(needle),
    );
  }, [query, visibleItems]);

  const groups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: filteredItems.filter((item) => item.group === group.key),
  })).filter((group) => group.items.length > 0);

  return (
    <div>
      <PageHeader
        title="Paramètres"
        description="Gérez votre compte, vos préférences et la configuration de la plateforme"
      />

      <Card className="mb-6 overflow-hidden">
        <div className="h-20 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.28),transparent_45%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_45%)]" />
        <CardContent className="-mt-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-4 border-surface bg-primary-600 text-2xl font-bold text-white shadow-lg">
              {initials(user?.name)}
            </div>
            <div className="min-w-0 pb-1">
              <h2 className="truncate text-lg font-semibold">
                {user?.name ?? "Mon compte"}
              </h2>
              <p className="truncate text-sm text-muted">{user?.email}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <UserRoleBadge role={user?.role} />
                <UserStatusBadge
                  status={user?.status}
                  isActive={user?.isActive}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 pb-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Dernière connexion {timeAgo(user?.lastLoginAt)}
            </span>
            <Link
              to="/settings/profile"
              className="inline-flex items-center gap-1 font-medium text-primary-600 hover:underline dark:text-primary-500"
            >
              Modifier mon profil
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="relative mb-6 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher un paramètre…"
          className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-9 text-sm text-slate-800 placeholder:text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-slate-100"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Effacer la recherche"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Aucun paramètre trouvé"
          description="Essayez un autre mot-clé ou effacez la recherche."
          action={
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-sm font-medium text-primary-600 hover:underline dark:text-primary-500"
            >
              Effacer la recherche
            </button>
          }
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`settings-${group.key}`}>
              <div className="mb-3">
                <h2
                  id={`settings-${group.key}`}
                  className="text-sm font-semibold"
                >
                  {group.title}
                </h2>
                <p className="text-xs text-muted">{group.description}</p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const showUnread =
                    item.to === "/settings/notifications" && unreadCount > 0;

                  return (
                    <Link key={item.to} to={item.to} className="group">
                      <Card className="h-full transition-colors group-hover:border-primary-500/60 group-focus-visible:border-primary-500/60">
                        <CardContent className="flex h-full items-start gap-4 py-4">
                          <div
                            className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                              item.accent,
                            )}
                          >
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                                <span className="truncate">{item.title}</span>
                                {showUnread && (
                                  <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                                    {unreadCount > 99 ? "99+" : unreadCount}
                                  </span>
                                )}
                              </h3>
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
                            </div>
                            <p className="mt-1 text-xs text-muted">
                              {item.description}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-8 text-xs text-muted">
        Les sections <strong>Intégrations</strong> et{" "}
        <strong>Administration</strong> sont réservées aux profils autorisés.
        Les contrôles d'accès restent appliqués par l'API.
      </p>
    </div>
  );
}
