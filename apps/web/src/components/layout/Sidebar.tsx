import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, FolderGit2, Github, GitBranch, Shield, AlertTriangle,
  Server, Rocket, FileText, ScrollText, Users, Settings, Bell, ChevronLeft, ChevronRight, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  showUnread?: boolean;
}

const sections: Array<{ title?: string; items: NavItem[] }> = [
  {
    items: [
      { to: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
      { to: "/notifications", label: "Notifications", icon: Bell, showUnread: true },
    ],
  },
  {
    title: "Développement",
    items: [
      { to: "/projects", label: "Projets", icon: FolderGit2 },
      { to: "/repositories", label: "Repositories", icon: Github },
      { to: "/pipelines", label: "Pipelines", icon: GitBranch },
    ],
  },
  {
    title: "Sécurité",
    items: [
      { to: "/security", label: "Analyses", icon: Shield },
      { to: "/vulnerabilities", label: "Vulnérabilités", icon: AlertTriangle },
    ],
  },
  {
    title: "Déploiement",
    items: [
      { to: "/servers", label: "Serveurs", icon: Server },
      { to: "/deployments", label: "Déploiements", icon: Rocket },
    ],
  },
  {
    title: "Rapports",
    items: [
      { to: "/reports", label: "Rapports", icon: FileText },
      { to: "/audit-logs", label: "Journal d'audit", icon: ScrollText, adminOnly: true },
    ],
  },
  {
    title: "Administration",
    items: [
      { to: "/users", label: "Utilisateurs", icon: Users, adminOnly: true },
      { to: "/settings", label: "Paramètres", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const { sidebarCollapsed, sidebarMobileOpen, toggleSidebar, closeMobileSidebar } = useUiStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN";
  const { data: unreadData } = useUnreadNotificationCount();
  const unreadCount = unreadData?.count ?? 0;

  const content = (
    <aside
      className={cn(
        "h-full bg-surface border-r border-border flex flex-col transition-[width] duration-200",
        sidebarCollapsed ? "w-16" : "w-64",
        "md:relative md:translate-x-0",
        sidebarMobileOpen
          ? "fixed inset-y-0 left-0 z-40 translate-x-0"
          : "fixed -translate-x-full md:translate-x-0",
      )}
    >
      <div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-md bg-primary-600 flex items-center justify-center text-white text-xs font-bold">
              DS
            </div>
            <span className="font-semibold truncate">DevSecOps</span>
          </div>
        )}
        <button
          onClick={closeMobileSidebar}
          className="md:hidden text-muted hover:text-slate-700 dark:hover:text-slate-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin py-2">
        {sections.map((section, si) => (
          <div key={si} className="mb-2">
            {section.title && !sidebarCollapsed && (
              <p className="px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted font-medium">
                {section.title}
              </p>
            )}
            {section.items
              .filter((it) => !it.adminOnly || isAdmin)
              .map((it) => {
                const badgeCount = it.showUnread ? unreadCount : 0;
                return (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    onClick={closeMobileSidebar}
                    className={({ isActive }) =>
                      cn(
                        "relative flex items-center gap-3 mx-2 px-2.5 py-1.5 rounded-md text-sm transition-colors",
                        sidebarCollapsed && "justify-center",
                        isActive
                          ? "bg-primary-600 text-white"
                          : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700/50",
                      )
                    }
                    title={
                      sidebarCollapsed
                        ? badgeCount > 0
                          ? `${it.label} (${badgeCount})`
                          : it.label
                        : undefined
                    }
                  >
                    <it.icon className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed && (
                      <span className="truncate">{it.label}</span>
                    )}
                    {badgeCount > 0 &&
                      (sidebarCollapsed ? (
                        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                      ) : (
                        <span className="ml-auto flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                          {badgeCount > 99 ? "99+" : badgeCount}
                        </span>
                      ))}
                  </NavLink>
                );
              })}
          </div>
        ))}
      </nav>

      <button
        onClick={toggleSidebar}
        className={cn(
          "hidden md:flex items-center gap-2 h-10 px-3 border-t border-border text-muted hover:text-slate-700 dark:hover:text-slate-200 text-xs",
          sidebarCollapsed && "justify-center",
        )}
      >
        {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : (
          <>
            <ChevronLeft className="w-4 h-4" />
            <span>Réduire</span>
          </>
        )}
      </button>
    </aside>
  );

  return (
    <>
      {/* Overlay mobile */}
      {sidebarMobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={closeMobileSidebar}
        />
      )}
      {content}
    </>
  );
}