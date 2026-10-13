// apps/web/src/features/dashboard/DashboardPage.tsx
import { Link } from "react-router-dom";
import {
  FolderGit2, GitBranch, ShieldAlert, Server,
  CheckCircle2, XCircle, ShieldX, Activity,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDashboardSummary } from "@/hooks/useDashboard";
import { formatDuration, timeAgo } from "@/lib/utils";
import type { PipelineStatus, Severity } from "@/types/api";

const SEVERITY_COLORS: Record<Severity, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#ea580c",
  MEDIUM: "#f59e0b",
  LOW: "#facc15",
  INFO: "#64748b",
};

const STATUS_COLORS: Record<PipelineStatus, string> = {
  QUEUED: "#64748b",
  RUNNING: "#2563eb",
  SUCCESS: "#059669",
  FAILED: "#dc2626",
  SECURITY_BLOCKED: "#d97706",
  CANCELLED: "#94a3b8",
};

export function DashboardPage() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useDashboardSummary();

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Tableau de bord" description="Vue synthétique de l'activité" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <PageHeader title="Tableau de bord" />
        <ErrorState
          title="Impossible de charger le tableau de bord"
          description={error instanceof Error ? error.message : "Une erreur est survenue."}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const { summary, pipelinesByStatus, vulnerabilitiesBySeverity, recentPipelines, topVulnerabilities } = data;

  const vulnData = (Object.keys(vulnerabilitiesBySeverity) as Severity[])
    .map((k) => ({ name: k, value: vulnerabilitiesBySeverity[k], color: SEVERITY_COLORS[k] }))
    .filter((d) => d.value > 0);

  const statusData = (Object.keys(pipelinesByStatus) as PipelineStatus[]).map((k) => ({
    name: k,
    value: pipelinesByStatus[k],
    color: STATUS_COLORS[k],
  }));

  return (
    <div>
      <PageHeader
        title="Tableau de bord"
        description={isRefetching ? "Actualisation…" : "Vue synthétique de l'activité"}
      />

      {/* Cartes principales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard icon={FolderGit2} label="Projets" value={summary.totalProjects} tone="info" />
        <StatCard icon={GitBranch} label="Pipelines" value={summary.totalPipelines} />
        <StatCard icon={Server} label="Serveurs" value={summary.totalServers} />
        <StatCard
          icon={ShieldAlert}
          label="Vulnérabilités"
          value={summary.totalVulnerabilities}
          subtitle={`${vulnerabilitiesBySeverity.CRITICAL} critiques · ${vulnerabilitiesBySeverity.HIGH} élevées`}
          tone="danger"
        />
      </div>

      {/* Statuts pipelines */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          icon={CheckCircle2}
          label="Pipelines réussis"
          value={pipelinesByStatus.SUCCESS}
          tone="success"
        />
        <StatCard
          icon={XCircle}
          label="Pipelines échoués"
          value={pipelinesByStatus.FAILED}
          tone="danger"
        />
        <StatCard
          icon={ShieldX}
          label="Bloqués par le Security Gate"
          value={pipelinesByStatus.SECURITY_BLOCKED}
          tone="warning"
        />
      </div>

      {/* Graphiques */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Vulnérabilités par sévérité</CardTitle>
          </CardHeader>
          <CardContent>
            {vulnData.length === 0 ? (
              <EmptyState title="Aucune vulnérabilité" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={vulnData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={95}
                    paddingAngle={2}
                  >
                    {vulnData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="flex flex-wrap gap-3 justify-center mt-3 text-xs">
              {vulnData.map((d) => (
                <span key={d.name} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                  {d.name} : {d.value}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipelines par statut</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={statusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#33415540" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} angle={-20} textAnchor="end" height={60} />
                <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {statusData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Derniers pipelines */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Derniers pipelines</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentPipelines.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="Aucun pipeline"
              description="Lance ton premier pipeline depuis la page d'un projet."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted border-b border-border">
                  <tr>
                    <th className="text-left py-2 px-5 font-medium">Projet</th>
                    <th className="text-left py-2 px-5 font-medium">Commit</th>
                    <th className="text-left py-2 px-5 font-medium">Branche</th>
                    <th className="text-left py-2 px-5 font-medium">Statut</th>
                    <th className="text-right py-2 px-5 font-medium">Durée</th>
                    <th className="text-right py-2 px-5 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPipelines.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-border/60 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30"
                    >
                      <td className="py-2.5 px-5">
                        <Link
                          to={`/projects/${p.project.id}/pipelines/${p.id}`}
                          className="text-primary-500 hover:underline"
                        >
                          {p.project.name}
                        </Link>
                      </td>
                      <td className="py-2.5 px-5 font-mono text-xs">{p.commitSha.slice(0, 8)}</td>
                      <td className="py-2.5 px-5">{p.branch}</td>
                      <td className="py-2.5 px-5">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="py-2.5 px-5 text-right text-muted">
                        {formatDuration(p.durationMs)}
                      </td>
                      <td className="py-2.5 px-5 text-right text-muted">{timeAgo(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top vulnérabilités */}
      <Card>
        <CardHeader>
          <CardTitle>Vulnérabilités critiques et élevées</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {topVulnerabilities.length === 0 ? (
            <EmptyState title="Aucune vulnérabilité critique ou élevée" />
          ) : (
            <div className="divide-y divide-border/60">
              {topVulnerabilities.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-slate-100 dark:hover:bg-slate-700/30"
                >
                  <StatusBadge
                    status={v.severity === "CRITICAL" ? "FAILED" : "SECURITY_BLOCKED"}
                  />
                  <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-muted">
                    {v.tool}
                  </span>
                  <span className="font-mono text-xs">{v.packageName ?? "—"}</span>
                  <span className="flex-1 truncate text-sm text-muted">{v.description}</span>
                  <Link
                    to={`/projects/${v.scan.project.id}`}
                    className="text-xs text-primary-500 hover:underline shrink-0"
                  >
                    {v.scan.project.name}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}