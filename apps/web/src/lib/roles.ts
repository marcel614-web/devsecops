// apps/web/src/lib/roles.ts

/** Rôles historiques conservés côté backend pour les anciens comptes. */
export function normalizeGlobalRole(role?: string | null) {
  if (role === "ADMIN") return "PLATFORM_ADMIN";
  if (role === "DEVELOPER") return "PLATFORM_USER";
  return role ?? null;
}

export function isPlatformAdminRole(role?: string | null) {
  return normalizeGlobalRole(role) === "PLATFORM_ADMIN";
}
