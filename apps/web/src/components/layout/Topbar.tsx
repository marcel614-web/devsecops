import { Menu } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationCenter } from "./NotificationCenter";
import { UserMenu } from "./UserMenu";
import { Breadcrumbs } from "./Breadcrumbs";

export function Topbar() {
  const { toggleMobileSidebar, sidebarMobileOpen } = useUiStore();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 md:px-4">
      <button
        type="button"
        onClick={toggleMobileSidebar}
        aria-label="Ouvrir le menu"
        aria-expanded={sidebarMobileOpen}
        aria-controls="app-sidebar"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-slate-200/70 dark:hover:bg-slate-700/60 md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <NotificationCenter />
        <ThemeToggle />
        <span className="mx-1.5 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
        <UserMenu />
      </div>
    </header>
  );
}
