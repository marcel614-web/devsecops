import { FolderGit2, GitBranch, ShieldAlert, Server, CheckCircle2, XCircle, ShieldX } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/feedback/EmptyState";

// ⚠️ PHASE 2 : données de démonstration (à remplacer en Phase 4 par /api/dashboard/summary)
const DEMO = {
  stats: {
    projects: 3,
    pipelines: 21,
    success: 8,
    failed: 4,
    blocked: 6,
    vulnCritical: 2,
    vulnHigh: 17,
    servers: 1,
  },
  recent: [
    { id: "1", project: "Demo Node", commit: "0c8c7f45", branch: "main", status: "SUCCESS" as const },
    { id: "2", project: "Demo Node", commit: "manual-179", branch: "main", status: "SECURITY_BLOCKED" as const },
    { id: "3", project: "API Ventes", commit: "a1b2c3d4", branch: "main", status: "FAILED" as const },
    { id: "4", project: "Demo Node", commit: "9f8e7d6c", branch: "develop", status: "RUNNING" as const },
  ],
};

export function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Tableau de bord"
        description="Vue synthétique de l'activité de la plateforme"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard icon={FolderGit2} label="Projets" value={DEMO.stats.projects} tone="info" />
        <StatCard icon={GitBranch} label="Pipelines" value={DEMO.stats.pipelines} tone="default" />
        <StatCard icon={Server} label="Serveurs" value={DEMO.stats.servers} tone="default" />
        <StatCard
          icon={ShieldAlert}
          label="Vulnérabilités"
          value={DEMO.stats.vulnCritical + DEMO.stats.vulnHigh}
          subtitle={`${DEMO.stats.vulnCritical} critiques, ${DEMO.stats.vulnHigh} élevées`}
          tone="danger"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard icon={CheckCircle2} label="Pipelines réussis" value={DEMO.stats.success} tone="success" />
        <StatCard icon={XCircle} label="Pipelines échoués" value={DEMO.stats.failed} tone="danger" />
        <StatCard icon={ShieldX} label="Bloqués sécurité" value={DEMO.stats.blocked} tone="warning" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activité récente</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {DEMO.recent.length === 0 ? (
            <EmptyState title="Aucune activité" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted border-b border-border">
                <tr>
                  <th className="text-left py-2 px-5 font-medium">Projet</th>
                  <th className="text-left py-2 px-5 font-medium">Commit</th>
                  <th className="text-left py-2 px-5 font-medium">Branche</th>
                  <th className="text-left py-2 px-5 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {DEMO.recent.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30">
                    <td className="py-2.5 px-5">{r.project}</td>
                    <td className="py-2.5 px-5 font-mono text-xs">{r.commit}</td>
                    <td className="py-2.5 px-5">{r.branch}</td>
                    <td className="py-2.5 px-5"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted italic mt-6">
        ⚠️ Phase 2 — données de démonstration. L'intégration API sera faite en Phase 4.
      </p>
    </div>
  );
}