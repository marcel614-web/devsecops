import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";

const LABELS: Record<string, string> = {
  dashboard: "Tableau de bord",
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
        const path = "/" + segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        const label = isId(seg) ? `${seg.slice(0, 8)}…` : LABELS[seg] ?? seg;

        return (
          <span key={path} className="flex items-center gap-1.5">
            <ChevronRight className="w-3.5 h-3.5 text-muted" />
            {isLast ? (
              <span className="font-medium">{label}</span>
            ) : (
              <Link to={path} className="text-muted hover:text-slate-700 dark:hover:text-slate-200">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}