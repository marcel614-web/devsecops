import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw,
  Filter,
  Activity,
  ShieldAlert,
  Trash2,
  Plus,
  Pencil,
  LogIn,
  GitBranch,
  Server,
  User,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { SearchInput } from "@/components/ui/SearchInput";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { auditService } from "@/services/audit.service";
import { userService } from "@/services/user.service";
import { useAuthStore } from "@/stores/authStore";
import { timeAgo, cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Classification des actions
// NOTE : on retire les ancres `^` pour matcher les actions type
// `PROJECT_CREATED`, `USER_LOGIN_SUCCESS`, `pipeline.run`, etc.
// L'ordre est important : du plus spécifique au plus générique.
// ---------------------------------------------------------------------------
type ActionStyle = {
  label: string;
  className: string;
  icon: React.ComponentType<{ className?: string }>;
};

const ACTION_MAP: Array<{ match: RegExp; style: ActionStyle }> = [
  {
    match: /LOGIN|LOGOUT|SIGNIN|SIGNOUT|AUTH/i,
    style: {
      label: "Authentification",
      className: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
      icon: LogIn,
    },
  },
  {
    match: /SECURITY|SCAN|VULN/i,
    style: {
      label: "Sécurité",
      className: "bg-orange-600/15 text-orange-600 dark:text-orange-400",
      icon: ShieldAlert,
    },
  },
  {
    match: /PIPELINE|TRIGGER/i,
    style: {
      label: "Pipeline",
      className: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
      icon: GitBranch,
    },
  },
  {
    match: /SERVER|DEPLOY/i,
    style: {
      label: "Infrastructure",
      className: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
      icon: Server,
    },
  },
  {
    match: /CREATE|ADD|REGISTER|INSTALL/i,
    style: {
      label: "Création",
      className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      icon: Plus,
    },
  },
  {
    match: /DELETE|REMOVE|REVOKE|PURGE/i,
    style: {
      label: "Suppression",
      className: "bg-red-600/15 text-red-600 dark:text-red-400",
      icon: Trash2,
    },
  },
  {
    match: /UPDATE|EDIT|MODIFY|PATCH|SYNC/i,
    style: {
      label: "Modification",
      className: "bg-amber-500/15 text-amber-600 dark:text-amber-500",
      icon: Pencil,
    },
  },
];

const DEFAULT_ACTION: ActionStyle = {
  label: "Action",
  className: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  icon: Activity,
};

function getActionStyle(action: string): ActionStyle {
  if (!action) return DEFAULT_ACTION;
  for (const { match, style } of ACTION_MAP) {
    if (match.test(action)) return style;
  }
  return DEFAULT_ACTION;
}

function initialsFrom(user: any): string {
  const name = user?.name ?? user?.email ?? "?";
  return String(name)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((s: string) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Catégories proposées dans le filtre.
// IMPORTANT : ces valeurs doivent correspondre aux clés gérées par l'API
// (apps/api/src/modules/audit/audit.service.ts → CATEGORY_KEYWORDS).
// ---------------------------------------------------------------------------
const CATEGORY_OPTIONS = [
  { value: "creation", label: "Création" },
  { value: "modification", label: "Modification" },
  { value: "suppression", label: "Suppression" },
  { value: "auth", label: "Authentification" },
  { value: "pipeline", label: "Pipeline" },
  { value: "infra", label: "Infrastructure" },
  { value: "security", label: "Sécurité" },
] as const;

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((c) => [c.value, c.label]),
);

type AppliedFilters = {
  search: string;
  category: string;
  userId: string;
  from: string;
  to: string;
};

const emptyFilters = (): AppliedFilters => ({
  search: "",
  category: "",
  userId: "",
  from: "",
  to: "",
});

// "2026-10-16" -> "16/10/2026"
function formatDay(value: string): string {
  const [y, m, d] = value.split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

export function AuditPage() {
  const { user: currentUser } = useAuthStore();
  const isAdmin = currentUser?.role === "ADMIN";

  // État "live" (inputs)
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // État "appliqué" (déclenche la requête)
  const [applied, setApplied] = useState<AppliedFilters>(emptyFilters);
  const [page, setPage] = useState(1);

  const { data: users } = useQuery({
    queryKey: ["users-list"],
    queryFn: () => userService.list({ pageSize: 100 }),
    enabled: !!isAdmin,
  });

  // -----------------------------------------------------------------------
  // Clé de requête PLATE — chaque filtre est un élément séparé.
  // React Query détecte tout changement et refait la requête immédiatement.
  // -----------------------------------------------------------------------
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: [
      "audit-logs",
      applied.search,
      applied.category,
      applied.userId,
      applied.from,
      applied.to,
      page,
    ],
    queryFn: () =>
      auditService.list({
        page,
        pageSize: 50,
        search: applied.search || undefined,
        category: applied.category || undefined,
        userId: applied.userId || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
      }),
    refetchInterval: 10_000,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? items.length;
  const totalPages = data?.totalPages ?? 1;

  const hasFilters =
    !!applied.search ||
    !!applied.category ||
    !!applied.userId ||
    !!applied.from ||
    !!applied.to;

  // L'utilisateur a modifié les champs sans encore cliquer "Appliquer".
  const isDirty =
    search !== applied.search ||
    category !== applied.category ||
    userId !== applied.userId ||
    from !== applied.from ||
    to !== applied.to;

  const userName = (id: string): string => {
    const found = users?.items?.find((u: any) => u.id === id);
    return found?.name ?? found?.email ?? id.slice(0, 8);
  };

  // Liste des filtres réellement appliqués (affichés en "chips").
  const chips: Array<{ key: keyof AppliedFilters; label: string; value: string }> = [];
  if (applied.search) chips.push({ key: "search", label: "Recherche", value: applied.search });
  if (applied.category)
    chips.push({
      key: "category",
      label: "Catégorie",
      value: CATEGORY_LABELS[applied.category] ?? applied.category,
    });
  if (applied.userId) chips.push({ key: "userId", label: "Utilisateur", value: userName(applied.userId) });
  if (applied.from) chips.push({ key: "from", label: "Du", value: formatDay(applied.from) });
  if (applied.to) chips.push({ key: "to", label: "Au", value: formatDay(applied.to) });

  const apply = () => {
    setPage(1);
    setApplied({ search, category, userId, from, to });
  };

  const reset = () => {
    setSearch("");
    setCategory("");
    setUserId("");
    setFrom("");
    setTo("");
    setApplied(emptyFilters());
    setPage(1);
  };

  // Retire un seul filtre appliqué (et vide aussi le champ correspondant).
  const removeFilter = (key: keyof AppliedFilters) => {
    setApplied((prev) => ({ ...prev, [key]: "" }));
    setPage(1);
    if (key === "search") setSearch("");
    if (key === "category") setCategory("");
    if (key === "userId") setUserId("");
    if (key === "from") setFrom("");
    if (key === "to") setTo("");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Journal d'audit"
        description="Historique des actions administratives"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Rafraîchir
          </Button>
        }
      />

      {/* Filtres */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface/70 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-muted">
            <Filter className="h-4 w-4" />
            Filtres
          </div>
          {isDirty && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Modifications non appliquées
            </span>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Rechercher…"
            />
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Catégorie d'action"
            >
              <option value="">Toutes les catégories</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            {isAdmin && (
              <Select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                aria-label="Utilisateur"
              >
                <option value="">Tous les utilisateurs</option>
                {users?.items?.map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                  </option>
                ))}
              </Select>
            )}
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Date de début"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Date de fin"
            />
            <Button
              type="submit"
              size="sm"
              variant={isDirty ? "primary" : "secondary"}
            >
              Appliquer
            </Button>
          </div>
        </form>

        {/* Filtres réellement appliqués */}
        {hasFilters && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <span className="text-xs font-medium text-muted">Filtres appliqués :</span>
            {chips.map((c) => (
              <span
                key={c.key}
                className="inline-flex items-center gap-1 rounded-full border border-primary-500/30 bg-primary-600/10 px-2.5 py-1 text-xs text-primary-700 dark:text-primary-300"
              >
                <span className="font-medium">{c.label} :</span>
                <span className="max-w-[14rem] truncate">{c.value}</span>
                <button
                  type="button"
                  onClick={() => removeFilter(c.key)}
                  aria-label={`Retirer le filtre ${c.label}`}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-primary-600/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={reset}
              className="text-xs font-medium text-muted underline hover:text-slate-700 dark:hover:text-slate-200"
            >
              Tout effacer
            </button>
          </div>
        )}
      </div>

      {/* Chargement initial */}
      {isLoading && (
        <Card>
          <CardContent className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 rounded-lg" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Erreur */}
      {isError && (
        <ErrorState
          title="Impossible de charger l'audit"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {/* Vide */}
      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={Activity}
          title={hasFilters ? "Aucun résultat" : "Aucune entrée"}
          description={
            hasFilters
              ? "Aucune entrée ne correspond à ces filtres."
              : "Le journal d'audit est vide pour le moment."
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={reset}>
                Réinitialiser les filtres
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Tableau */}
      {!isLoading && !isError && items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-3 text-sm text-muted">
              <span className="tabular-nums">
                {items.length} sur {total} entrée{total > 1 ? "s" : ""}
                {hasFilters && " (filtré)"}
              </span>
              <span className="text-xs">Actualisation toutes les 10 s</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-slate-50/60 text-xs text-muted dark:bg-slate-800/30">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-left font-medium">Utilisateur</th>
                    <th className="px-4 py-2.5 text-left font-medium">Action</th>
                    <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">
                      Cible
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((entry: any) => {
                    const style = getActionStyle(entry.action);
                    const Icon = style.icon;
                    const userLabel =
                      entry.user?.name ?? entry.user?.email ?? "Système";
                    const targetLabel = entry.targetType
                      ? `${entry.targetType}${
                          entry.targetId
                            ? ` : ${String(entry.targetId).slice(0, 8)}`
                            : ""
                        }`
                      : "—";

                    return (
                      <tr
                        key={entry.id}
                        className="border-b border-border/60 transition-colors last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-muted">
                          {timeAgo(entry.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                              aria-hidden
                            >
                              {entry.user ? (
                                initialsFrom(entry.user)
                              ) : (
                                <User className="h-3.5 w-3.5" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {userLabel}
                              </p>
                              {entry.user?.email && entry.user?.name && (
                                <p className="truncate text-xs text-muted">
                                  {entry.user.email}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
                                style.className,
                              )}
                            >
                              <Icon className="h-3 w-3" />
                              {style.label}
                            </span>
                            <span className="font-mono text-xs text-muted">
                              {entry.action}
                            </span>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">
                          <span className="rounded bg-slate-200/60 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-700/60">
                            {targetLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="border-t border-border px-5 py-3">
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  onPage={setPage}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
