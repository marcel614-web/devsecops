import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { User, LogOut, Settings, ChevronDown } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const initials = (user?.name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-700/60"
      >
        <div className="w-7 h-7 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center">
          {initials}
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-muted" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-60 bg-surface border border-border rounded-lg shadow-xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-medium truncate">{user?.name ?? "-"}</p>
            <p className="text-xs text-muted truncate">{user?.email ?? "-"}</p>
            <span className="inline-block mt-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary-600/20 text-primary-600 dark:text-primary-500 font-semibold">
              {user?.role ?? "-"}
            </span>
          </div>
          <button
            onClick={() => { setOpen(false); navigate("/settings"); }}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700/40"
          >
            <Settings className="w-4 h-4" /> Paramètres
          </button>
          <button
            onClick={() => { setOpen(false); navigate("/settings"); }}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700/40"
          >
            <User className="w-4 h-4" /> Profil
          </button>
          <button
            onClick={() => { logout(); navigate("/login"); }}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-500/10"
          >
            <LogOut className="w-4 h-4" /> Déconnexion
          </button>
        </div>
      )}
    </div>
  );
}