import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { User, LogOut, Settings, ChevronDown } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { authService } from "@/services/auth.service";
import { useDismissable } from "@/hooks/useDismissable";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrateur",
};

const itemClass =
  "flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm focus:outline-none";

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const close = useCallback(() => setOpen(false), []);
  useDismissable(ref, open, close, triggerRef);

  // Ouverture : le focus passe au premier élément du menu
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const handleLogout = async () => {
    setOpen(false);
    try {
      await authService.logout();
    } catch {
      // On déconnecte quand même localement
    }
    logout();
    navigate("/login", { replace: true });
  };

  // Navigation clavier : ↑ ↓ Début Fin
  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (index + 1) % items.length;
    else if (e.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      items[next].focus();
    }
  };

  const name = user?.name ?? "Utilisateur";
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
  const roleLabel = user?.role ? ROLE_LABELS[user.role] ?? user.role : "";

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu utilisateur, ${name}`}
        className="flex h-9 items-center gap-2 rounded-md pl-1 pr-2 transition-colors hover:bg-slate-200/70 dark:hover:bg-slate-700/60"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">
          {initials}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-medium lg:block">{name}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 text-muted transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Compte utilisateur"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted">{user?.email ?? "-"}</p>
            {roleLabel && (
              <span className="mt-1.5 inline-block rounded bg-primary-600/15 px-1.5 py-0.5 text-[11px] font-medium text-primary-600 dark:text-primary-500">
                {roleLabel}
              </span>
            )}
          </div>

          <div className="py-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => go("/settings/profile")}
              className={cn(itemClass, "hover:bg-slate-100 focus:bg-slate-100 dark:hover:bg-slate-700/40 dark:focus:bg-slate-700/40")}
            >
              <User className="h-4 w-4 text-muted" aria-hidden="true" /> Mon profil
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => go("/settings")}
              className={cn(itemClass, "hover:bg-slate-100 focus:bg-slate-100 dark:hover:bg-slate-700/40 dark:focus:bg-slate-700/40")}
            >
              <Settings className="h-4 w-4 text-muted" aria-hidden="true" /> Paramètres
            </button>
          </div>

          <div className="border-t border-border py-1" role="none">
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className={cn(itemClass, "text-red-600 hover:bg-red-500/10 focus:bg-red-500/10 dark:text-red-400")}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" /> Se déconnecter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
