// apps/web/src/app/guards.tsx
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import type { AuthUser } from "@/services/auth.service";

interface GuardProps {
  children: React.ReactNode;
}

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-sm text-muted">Chargement…</div>
    </div>
  );
}

/** Bloque l'accès si l'utilisateur n'est pas connecté. */
export function ProtectedRoute({ children }: GuardProps) {
  const { user, loading } = useAuthStore();
  const location = useLocation();

  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Empêche un utilisateur connecté d'accéder à /login ou /register. */
export function GuestRoute({ children }: GuardProps) {
  const { user, loading } = useAuthStore();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AccessDenied({ message }: { message: string }) {
  return (
    <div className="p-8">
      <div className="max-w-md mx-auto bg-surface border border-border rounded-lg p-6 text-center">
        <h2 className="font-semibold text-lg mb-2">Accès refusé</h2>
        <p className="text-sm text-muted">{message}</p>
      </div>
    </div>
  );
}

/** Réserve une route à une permission globale effective. */
export function PermissionGuard({
  children,
  permission,
}: GuardProps & { permission: string }) {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;

  const normalize = (role: string) =>
    role === "ADMIN" ? "PLATFORM_ADMIN" : role === "DEVELOPER" ? "PLATFORM_USER" : role;
  const isAdmin = normalize(user.role) === "PLATFORM_ADMIN";
  if (!isAdmin && !user.globalPermissions?.includes(permission)) {
    return (
      <AccessDenied message="Vous n'avez pas la permission requise pour cette section." />
    );
  }
  return <>{children}</>;
}

/** Réserve une route à certains rôles. */
export function RoleGuard({
  children,
  roles,
}: GuardProps & { roles: AuthUser["role"][] }) {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;

  const normalize = (role: string) =>
    role === "ADMIN" ? "PLATFORM_ADMIN" : role === "DEVELOPER" ? "PLATFORM_USER" : role;
  const allowed = roles.map(normalize);
  if (!allowed.includes(normalize(user.role))) {
    return (
      <AccessDenied message="Cette section est réservée aux administrateurs." />
    );
  }
  return <>{children}</>;
}