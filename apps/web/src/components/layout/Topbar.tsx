import { Menu } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationCenter } from "./NotificationCenter";
import { UserMenu } from "./UserMenu";
import { Breadcrumbs } from "./Breadcrumbs";

export function Topbar() {
  const { toggleMobileSidebar } = useUiStore();

  return (
    <header className="h-14 shrink-0 border-b border-border bg-surface flex items-center gap-3 px-4">
      <button
        onClick={toggleMobileSidebar}
        className="md:hidden text-muted hover:text-slate-700 dark:hover:text-slate-200"
        aria-label="Ouvrir le menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      <Breadcrumbs />

      <div className="flex-1" />

      <NotificationCenter />
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}