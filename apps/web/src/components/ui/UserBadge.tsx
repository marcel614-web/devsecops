// apps/web/src/components/ui/UserBadge.tsx
import type { Role, UserStatus } from "@/types/api";
import { normalizeGlobalRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { SimpleBadge } from "./Badge";

/** Initiales d'affichage (2 caractères maximum). */
export function initials(name?: string | null): string {
  const value = (name ?? "?").trim();
  if (!value) return "?";
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: "Administrateur plateforme",
  PLATFORM_USER: "Utilisateur plateforme",
};

const ROLE_STYLES: Record<string, string> = {
  PLATFORM_ADMIN:
    "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  PLATFORM_USER: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
};

export function UserRoleBadge({
  role,
  className,
}: {
  role?: Role | string | null;
  className?: string;
}) {
  const normalized = normalizeGlobalRole(role) ?? "PLATFORM_USER";
  return (
    <SimpleBadge className={cn(ROLE_STYLES[normalized], className)}>
      {ROLE_LABELS[normalized] ?? normalized}
    </SimpleBadge>
  );
}

const STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: "Actif",
  SUSPENDED: "Suspendu",
  PENDING: "En attente",
  DISABLED: "Désactivé",
};

const STATUS_STYLES: Record<UserStatus, string> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  SUSPENDED: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  PENDING: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  DISABLED: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};

export function UserStatusBadge({
  status,
  isActive,
  className,
}: {
  status?: UserStatus | string | null;
  isActive?: boolean;
  className?: string;
}) {
  const resolved: UserStatus =
    (status as UserStatus | undefined) ??
    (isActive === false ? "DISABLED" : "ACTIVE");

  return (
    <SimpleBadge className={cn(STATUS_STYLES[resolved], className)}>
      {STATUS_LABELS[resolved] ?? resolved}
    </SimpleBadge>
  );
}
