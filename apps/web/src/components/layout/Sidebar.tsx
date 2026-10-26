import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, FolderGit2, Github, GitBranch, Shield, AlertTriangle,
  Server, Rocket, FileText, ScrollText, Users, Settings, Bell,
  PanelLeftClose, PanelLeftOpen, X,
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

  // Le tiroir mobile est toujours déployé (libellés visibles)
  const collapsed = sidebarCollapsed && !sidebarMobileOpen;

  // Mobile : Échap ferme le tiroir, le fond ne défile plus
  useEffect(() => {
    if (!sidebarMobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMobileSidebar();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [sidebarMobileOpen, closeMobileSidebar]);

  const visibleSections = sections
    .map((s) => ({ ...s, items: s.items.filter((it) => !it.adminOnly || isAdmin) }))
    .filter((s) => s.items.length > 0);

  return (
    <>
      {/* Fond du tiroir mobile */}
      <div
        aria-hidden="true"
        onClick={closeMobileSidebar}
        className={cn(
          "fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-[1px] transition-opacity duration-200 md:hidden",
          sidebarMobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        id="app-sidebar"
        className={cn(
          "flex h-full flex-col border-r border-border bg-surface",
          "fixed inset-y-0 left-0 z-40 w-64 transition-[transform,width] duration-200 ease-out",
          "md:static md:translate-x-0",
          collapsed ? "md:w-16" : "md:w-64",
          sidebarMobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full max-md:invisible",
        )}
      >
        {/* En-tête : logo toujours visible */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-border px-4",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          <NavLink
            to="/dashboard"
            onClick={closeMobileSidebar}
            aria-label="DevSecOps – accueil"
            className="flex min-w-0 items-center gap-2.5 rounded-md"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-600 text-xs font-bold text-white">
              DS
            </span>
            {!collapsed && <span className="truncate font-semibold">DevSecOps</span>}
          </NavLink>

          <button
            type="button"
            onClick={closeMobileSidebar}
            aria-label="Fermer le menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-slate-200/70 dark:hover:bg-slate-700/60 md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav
          aria-label="Navigation principale"
          className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden py-3"
        >
          {visibleSections.map((section, si) => (
            <div key={si} role="group" aria-label={section.title} className="mb-1">
              {section.title &&
                (collapsed ? (
                  <div className="mx-4 my-2 border-t border-border" aria-hidden="true" />
                ) : (
                  <p className="px-5 pb-1 pt-3 text-xs font-medium text-muted">{section.title}</p>
                ))}

              <ul className="space-y-0.5">
                {section.items.map((it) => {
                  const badge = it.showUnread ? unreadCount : 0;
                  const badgeLabel = badge > 99 ? "99+" : String(badge);
                  const accessibleName =
                    badge > 0 ? `${it.label}, ${badge} non lue${badge > 1 ? "s" : ""}` : it.label;

                  return (
                    <li key={it.to}>
                      <NavLink
                        to={it.to}
                        onClick={closeMobileSidebar}
                        aria-label={collapsed ? accessibleName : undefined}
                        title={collapsed ? accessibleName : undefined}
                        className={({ isActive }) =>
                          cn(
                            "relative mx-2 flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
                            collapsed && "justify-center",
                            isActive
                              ? "bg-primary-600 font-medium text-white"
                              : "text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700/50",
                          )
                        }
                      >
                        <it.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {!collapsed && <span className="truncate">{it.label}</span>}
                        {badge > 0 &&
                          (collapsed ? (
                            <span
                              aria-hidden="true"
                              className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-surface"
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="ml-auto flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white"
                            >
                              {badgeLabel}
                            </span>
                          ))}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={toggleSidebar}
          aria-expanded={!sidebarCollapsed}
          aria-controls="app-sidebar"
          title={sidebarCollapsed ? "Développer le menu" : undefined}
          className={cn(
            "hidden h-11 shrink-0 items-center gap-2 border-t border-border px-4 text-xs text-muted hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700/40 dark:hover:text-slate-200 md:flex",
            sidebarCollapsed && "justify-center px-0",
          )}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-label="Développer le menu" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              <span>Réduire le menu</span>
            </>
          )}
        </button>
      </aside>
    </>
  );
}
