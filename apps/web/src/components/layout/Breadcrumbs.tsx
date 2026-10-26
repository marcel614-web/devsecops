import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  dashboard: "Tableau de bord",
  notifications: "Notifications",
  projects: "Projets",
  repositories: "Repositories",
  pipelines: "Pipelines",
  security: "Analyses",
  vulnerabilities: "Vulnérabilités",
  servers: "Serveurs",
  deployments: "Déploiements",
  reports: "Rapports",
  "audit-logs": "Journal d'audit",
  users: "Utilisateurs",
  settings: "Paramètres",
  profile: "Profil",
  config: "Configuration",
};

function isId(seg: string) {
  return seg.length >= 20 && /^[a-z0-9]+$/i.test(seg);
}

// Sous-sections d'un projet : il n'existe pas de route autonome
// `/projects/:id/<section>` ; elles sont rendues via l'onglet du projet.
const PROJECT_TABS = new Set(["pipelines", "vulnerabilities", "config"]);

/**
 * Calcule la cible d'un segment du fil d'Ariane.
 * On évite ainsi de générer des liens morts (ex. `/projects/:id/pipelines`).
 */
function resolveHref(segments: string[], index: number): string {
  if (segments[0] === "projects" && isId(segments[1] ?? "")) {
    const section = segments[index];
    if (index === 2 && section && PROJECT_TABS.has(section)) {
      return `/projects/${segments[1]}?tab=${section}`;
    }
  }
  return "/" + segments.slice(0, index + 1).join("/");
}

const linkClass =
  "rounded text-muted transition-colors hover:text-slate-800 dark:hover:text-slate-100";

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <nav aria-label="Fil d'Ariane" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        <li className="hidden shrink-0 md:block">
          <Link to="/dashboard" className={cn(linkClass, "flex items-center")} aria-label="Accueil">
            <Home className="h-4 w-4" aria-hidden="true" />
          </Link>
        </li>

        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          const id = isId(seg);
          const label = id ? `${seg.slice(0, 8)}…` : LABELS[seg] ?? seg;
          const href = resolveHref(segments, i);

          return (
            <li
              key={href}
              // Mobile : seule la page courante est affichée
              className={cn("min-w-0 items-center gap-1.5", isLast ? "flex" : "hidden md:flex")}
            >
              <ChevronRight
                className="hidden h-3.5 w-3.5 shrink-0 text-muted md:block"
                aria-hidden="true"
              />
              {isLast ? (
                <span
                  aria-current="page"
                  title={id ? seg : undefined}
                  className={cn("truncate font-medium", id && "font-mono text-xs")}
                >
                  {label}
                </span>
              ) : (
                <Link
                  to={href}
                  title={id ? seg : undefined}
                  className={cn(linkClass, "truncate", id && "font-mono text-xs")}
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
