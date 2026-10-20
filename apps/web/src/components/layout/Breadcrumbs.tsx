import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";

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

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <nav className="hidden md:flex items-center gap-1.5 text-sm">
      <Link to="/dashboard" className="text-muted hover:text-slate-700 dark:hover:text-slate-200">
        Accueil
      </Link>
      {segments.map((seg, i) => {
        const key = "/" + segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        const label = isId(seg) ? `${seg.slice(0, 8)}…` : LABELS[seg] ?? seg;
        const href = resolveHref(segments, i);

        return (
          <span key={key} className="flex items-center gap-1.5">
            <ChevronRight className="w-3.5 h-3.5 text-muted" />
            {isLast ? (
              <span className="font-medium">{label}</span>
            ) : (
              <Link to={href} className="text-muted hover:text-slate-700 dark:hover:text-slate-200">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}