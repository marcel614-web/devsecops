import { Link, useNavigate } from "react-router-dom";
import { FolderGit2, GitBranch, ShieldAlert, Server, CheckCircle2, XCircle, ShieldX, Activity, RefreshCw, TrendingUp, ArrowRight } from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { StatusBadge, SeverityBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDashboardSummary } from "@/hooks/useDashboard";
import { formatDuration, timeAgo, cn } from "@/lib/utils";
import type { PipelineStatus, Severity } from "@/types/api";

const SEVERITY_COLORS: Record<Severity, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#ea580c",
  MEDIUM: "#f59e0b",
  LOW: "#facc15",
  INFO: "#64748b",
};
const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: "Critiques",
  HIGH: "Élevées",
  MEDIUM: "Moyennes",
  LOW: "Faibles",
  INFO: "Info",
};

const STATUS_COLORS: Record<PipelineStatus, string> = {
  QUEUED: "#64748b",
  RUNNING: "#2563eb",
  SUCCESS: "#059669",
  FAILED: "#dc2626",
  SECURITY_BLOCKED: "#d97706",
  CANCELLED: "#94a3b8",
};
const STATUS_LABELS: Record<PipelineStatus, string> = {
  QUEUED: "En attente",
  RUNNING: "En cours",
  SUCCESS: "Réussis",
  FAILED: "Échoués",
  SECURITY_BLOCKED: "Bloqués",
  CANCELLED: "Annulés",
};

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name?: string; value?: number; payload?: { label?: string } }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg">
      <span className="text-muted">{p.payload?.label ?? p.name} : </span>
      <span className="font-semibold tabular-nums">{p.value}</span>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch, isRefetching } = useDashboardSummary();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Tableau de bord" description="Vue d'ensemble de l'activité et de la sécurité" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><Skeleton className="h-80 rounded-xl" /><Skeleton className="h-80 rounded-xl" /></div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <PageHeader title="Tableau de bord" />
        <ErrorState title="Impossible de charger le tableau de bord" description={error instanceof Error ? error.message : "Une erreur est survenue."} onRetry={() => refetch()} />
      </div>
    );
  }

  const { summary, pipelinesByStatus, vulnerabilitiesBySeverity, recentPipelines, topVulnerabilities } = data;

  const vulnData = (Object.keys(vulnerabilitiesBySeverity) as Severity[])
    .map((k) => ({ key: k, label: SEVERITY_LABELS[k] ?? k, value: vulnerabilitiesBySeverity[k], color: SEVERITY_COLORS[k] }))
    .filter((d) => d.value > 0);
  const vulnTotal = vulnData.reduce((s, d) => s + d.value, 0);

  const statusData = (Object.keys(pipelinesByStatus) as PipelineStatus[]).map((k) => ({
    key: k, label: STATUS_LABELS[k] ?? k, value: pipelinesByStatus[k], color: STATUS_COLORS[k],
  }));

  const finished = pipelinesByStatus.SUCCESS + pipelinesByStatus.FAILED + pipelinesByStatus.SECURITY_BLOCKED;
  const successRate = finished > 0 ? Math.round((pipelinesByStatus.SUCCESS / finished) * 100) : null;
  const active = (pipelinesByStatus.RUNNING ?? 0) + (pipelinesByStatus.QUEUED ?? 0);
  const criticals = vulnerabilitiesBySeverity.CRITICAL;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord"
        description="Vue d'ensemble de l'activité et de la sécurité"
        actions={
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isRefetching} className="gap-1.5">
            <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} /> Actualiser
          </Button>
        }
      />

      {/* Alerte sécurité */}
      {criticals > 0 && (
        <Link
          to="/pipelines"
          className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm transition-colors hover:bg-red-500/15 focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <ShieldAlert className="h-5 w-5 shrink-0 text-red-500" />
          <span className="flex-1 text-red-700 dark:text-red-300">
            <strong className="tabular-nums">{criticals}</strong> vulnérabilité{criticals > 1 ? "s" : ""} critique{criticals > 1 ? "s" : ""} à corriger en priorité.
          </span>
          <ArrowRight className="h-4 w-4 text-red-500" />
        </Link>
      )}

      {/* KPI */}
      <section aria-label="Indicateurs clés" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={FolderGit2} label="Projets" value={summary.totalProjects} tone="info" />
        <StatCard icon={GitBranch} label="Pipelines" value={summary.totalPipelines} subtitle={active > 0 ? `${active} en cours` : "Aucun en cours"} />
        <StatCard icon={Server} label="Serveurs" value={summary.totalServers} />
        <StatCard
          icon={ShieldAlert}
          label="Vulnérabilités"
          value={summary.totalVulnerabilities}
          subtitle={`${criticals} critiques · ${vulnerabilitiesBySeverity.HIGH} élevées`}
          tone="danger"
        />
      </section>

      <section aria-label="Résultats des pipelines" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={TrendingUp} label="Taux de réussite" value={successRate === null ? "—" : `${successRate} %`} subtitle={`sur ${finished} pipeline${finished > 1 ? "s" : ""} terminé${finished > 1 ? "s" : ""}`} tone={successRate !== null && successRate < 70 ? "warning" : "success"} />
        <StatCard icon={CheckCircle2} label="Réussis" value={pipelinesByStatus.SUCCESS} tone="success" />
        <StatCard icon={XCircle} label="Échoués" value={pipelinesByStatus.FAILED} tone="danger" />
        <StatCard icon={ShieldX} label="Bloqués (Security Gate)" value={pipelinesByStatus.SECURITY_BLOCKED} tone="warning" />
      </section>

      {/* Graphiques */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Vulnérabilités par sévérité</CardTitle></CardHeader>
          <CardContent>
            {vulnData.length === 0 ? (
              <EmptyState title="Aucune vulnérabilité" description="Les résultats des scans apparaîtront ici." />
            ) : (
              <div className="flex flex-col items-center gap-4 sm:flex-row">
                <div className="relative h-56 w-56 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={vulnData} dataKey="value" nameKey="label" innerRadius={65} outerRadius={100} paddingAngle={2} stroke="none">
                        {vulnData.map((d) => <Cell key={d.key} fill={d.color} />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold tabular-nums">{vulnTotal}</span>
                    <span className="text-xs text-muted">au total</span>
                  </div>
                </div>
                <ul className="w-full flex-1 space-y-2 text-sm">
                  {vulnData.map((d) => (
                    <li key={d.key} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
                      <span className="flex-1">{d.label}</span>
                      <span className="font-medium tabular-nums">{d.value}</span>
                      <span className="w-10 text-right text-xs tabular-nums text-muted">{Math.round((d.value / vulnTotal) * 100)} %</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Pipelines par statut</CardTitle></CardHeader>
          <CardContent>
            {summary.totalPipelines === 0 ? (
              <EmptyState icon={Activity} title="Aucun pipeline" description="Lancez un pipeline depuis la page d'un projet." />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#94a3b833" />
                    <XAxis type="number" allowDecimals={false} stroke="#94a3b8" fontSize={11} />
                    <YAxis type="category" dataKey="label" width={72} stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "#94a3b81a" }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
                      {statusData.map((d) => <Cell key={d.key} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Derniers pipelines */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Derniers pipelines</CardTitle>
            <Link to="/pipelines" className="inline-flex items-center gap-1 text-xs text-primary-500 hover:underline">Tout voir <ArrowRight className="h-3 w-3" /></Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentPipelines.length === 0 ? (
            <EmptyState icon={Activity} title="Aucun pipeline" description="Lancez votre premier pipeline depuis la page d'un projet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-border bg-slate-50/60 text-xs text-muted dark:bg-slate-800/30">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-medium">Projet</th>
                    <th className="px-5 py-2.5 text-left font-medium">Commit</th>
                    <th className="hidden px-5 py-2.5 text-left font-medium md:table-cell">Branche</th>
                    <th className="px-5 py-2.5 text-left font-medium">Statut</th>
                    <th className="hidden px-5 py-2.5 text-right font-medium sm:table-cell">Durée</th>
                    <th className="px-5 py-2.5 text-right font-medium">Lancé</th>
                    <th className="w-10 px-3 py-2.5"><span className="sr-only">Ouvrir</span></th>
                  </tr>
                </thead>
                <tbody>
                  {recentPipelines.map((p) => (
                    <tr
                      key={p.id}
                      className="group cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a,button")) return;
                        navigate(`/projects/${p.project.id}/pipelines/${p.id}`);
                      }}
                    >
                      <td className="px-5 py-3">
                        <Link to={`/projects/${p.project.id}/pipelines/${p.id}`} className="font-medium text-primary-600 hover:underline dark:text-primary-400">{p.project.name}</Link>
                      </td>
                      <td className="px-5 py-3"><span className="rounded bg-slate-200/60 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-700/60">{p.commitSha.slice(0, 7)}</span></td>
                      <td className="hidden px-5 py-3 text-muted md:table-cell"><span className="inline-flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" />{p.branch}</span></td>
                      <td className="px-5 py-3"><StatusBadge status={p.status} /></td>
                      <td className="hidden px-5 py-3 text-right tabular-nums text-muted sm:table-cell">{formatDuration(p.durationMs)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-muted">{timeAgo(p.createdAt)}</td>
                      <td className="px-3 py-3 text-right text-muted">
                        <ArrowRight className="h-4 w-4 transition-colors group-hover:text-primary-500" aria-hidden="true" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vulnérabilités prioritaires */}
      <Card>
        <CardHeader><CardTitle>Vulnérabilités prioritaires</CardTitle></CardHeader>
        <CardContent className="p-0">
          {topVulnerabilities.length === 0 ? (
            <EmptyState icon={ShieldX} title="Aucune vulnérabilité critique ou élevée" description="Tout est sous contrôle pour le moment." />
          ) : (
            <ul className="divide-y divide-border/60 border-t border-border/60">
              {topVulnerabilities.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700/30">
                  <SeverityBadge severity={v.severity} />
                  <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] text-muted dark:bg-slate-700">{v.tool}</span>
                  <span className="font-mono text-xs">{v.packageName ?? "—"}</span>
                  <span className="min-w-0 flex-1 basis-48 truncate text-sm text-muted" title={v.description ?? ""}>{v.description}</span>
                  <Link to={`/projects/${v.scan.project.id}?tab=vulnerabilities`} className="shrink-0 text-xs text-primary-500 hover:underline">{v.scan.project.name}</Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
