// apps/web/src/app/providers.tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { useEffect } from "react";
import { queryClient } from "./queryClient";
import { ToastProvider } from "@/components/feedback/Toast";
import { authService } from "@/services/auth.service";
import { useAuthStore } from "@/stores/authStore";

function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading, logout } = useAuthStore();

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      setLoading(false);
      return;
    }
    authService
      .me()
      .then((u) => setUser(u))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [setUser, setLoading, logout]);

  useEffect(() => {
    const onExpired = () => {
      logout();
      // Petite redirection douce
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    };
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, [logout]);

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthBootstrap>{children}</AuthBootstrap>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}