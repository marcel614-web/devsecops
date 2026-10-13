import { LogOut, User as UserIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { authApi } from "@/services/auth.api";

export function Header() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    logout();
    navigate("/login");
  };

  return (
    <header className="h-14 border-b border-border bg-panel flex items-center justify-between px-6">
      <div className="text-sm text-slate-400">Bienvenue sur la plateforme DevSecOps</div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <UserIcon className="w-4 h-4" />
          <span>{user?.name ?? "-"}</span>
          <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">
            {user?.role ?? "-"}
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white px-2 py-1 rounded hover:bg-slate-700"
        >
          <LogOut className="w-4 h-4" /> Déconnexion
        </button>
      </div>
    </header>
  );
}