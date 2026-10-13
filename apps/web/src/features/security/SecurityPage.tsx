// apps/web/src/features/security/SecurityPage.tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Shield, ShieldAlert, ShieldCheck, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { SeveritySummaryCards } from "@/components/security/SeveritySummaryCards";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { securityService } from "@/services/security.service";
import { formatDuration, timeAgo } from "@/lib/utils";

export function SecurityPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["security-overview"],
    queryFn: securityService.overview,
    refetchInterval: 30_000,
  });

  return (
    <div>
      <PageHeader
        title="Centre de sécurité"
        description="Vue d'ensemble des analyses de sécurité et des blocages"
      />

      {isLoading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64 mb-6" />
          <Skeleton className="h-64" />
        </>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger le centre de sécurité"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {data && (
        <>
          {/* Compteurs */}
          <div className="mb-6">
            <SeveritySummaryCards counts={data.severityCounts} />
          </div>

          {/* Derniers scans */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary-500" />
                Analyses récentes
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.recentScans.length === 0 ? (
                <EmptyState
                  icon={Shield}
                  title="Aucune analyse récente"
                  description="Lance un pipeline pour voir les scans apparaître ici."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-muted border-b border-border">
                      <tr>
                        <th className="text-left py-2 px-5 font-medium">Scanner</th>
                        <th className="text-left py-2 px-5 font-medium">Type</th>
                        <th className="text-left py-2 px-5 font-medium">Projet</th>
                        <th className="text-left py-2 px-5 font-medium">Commit</th>
                        <th className="text-left py-2 px-5 font-medium">Résultats</th>
                        <th className="text-right py-2 px-5 font-medium">Durée</th>
                        <th className="text-right py-2 px-5 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentScans.map((s) => {
                        const total =
                          s.criticalCount +
                          s.highCount +
                          s.mediumCount +
                          s.lowCount +
                          s.infoCount;
                        return (
                          <tr
                            key={s.id}
                            className="border-b border-border/60 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30"
                          >
                            <td className="py-2.5 px-5 font-medium">{s.scanner}</td>
                            <td className="py-2.5 px-5 text-xs text-muted">{s.type}</td>
                            <td className="py-2.5 px-5">
                              <Link
                                to={`/projects/${s.pipeline.project.id}?tab=pipelines`}
                                className="text-primary-500 hover:underline"
                              >
                                {s.pipeline.project.name}
                              </Link>
                            </td>
                            <td className="py-2.5 px-5">
                              <Link
                                to={`/projects/${s.pipeline.project.id}/pipelines/${s.pipeline.id}`}
                                className="font-mono text-xs text-primary-500 hover:underline"
                              >
                                {s.pipeline.commitSha.slice(0, 8)}
                              </Link>
                            </td>
                            <td className="py-2.5 px-5">
                              {total === 0 ? (
                                <span className="text-emerald-500 text-xs flex items-center gap-1">
                                  <ShieldCheck className="w-3 h-3" /> 0 résultat
                                </span>
                              ) : (
                                <div className="flex gap-1 text-xs">
                                  {s.criticalCount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded bg-red-700 text-white font-bold">
                                      {s.criticalCount}C
                                    </span>
                                  )}
                                  {s.highCount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded bg-orange-600 text-white font-bold">
                                      {s.highCount}H
                                    </span>
                                  )}
                                  {s.mediumCount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-500 text-black font-bold">
                                      {s.mediumCount}M
                                    </span>
                                  )}
                                  {s.lowCount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded bg-yellow-300 text-black font-bold">
                                      {s.lowCount}L
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-5 text-right text-muted text-xs">
                              {formatDuration(s.durationMs)}
                            </td>
                            <td className="py-2.5 px-5 text-right text-muted text-xs">
                              {timeAgo(s.createdAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pipelines bloqués */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-500" />
                Pipelines bloqués par le Security Gate
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.blockedPipelines.length === 0 ? (
                <EmptyState
                  icon={ShieldCheck}
                  title="Aucun pipeline bloqué"
                  description="Aucun seuil de sécurité n'a été dépassé."
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
                        <th className="text-right py-2 px-5 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.blockedPipelines.map((pl) => (
                        <tr
                          key={pl.id}
                          className="border-b border-border/60 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30"
                        >
                          <td className="py-2.5 px-5">
                            <Link
                              to={`/projects/${pl.project.id}?tab=pipelines`}
                              className="text-primary-500 hover:underline"
                            >
                              {pl.project.name}
                            </Link>
                          </td>
                          <td className="py-2.5 px-5">
                            <Link
                              to={`/projects/${pl.project.id}/pipelines/${pl.id}`}
                              className="font-mono text-xs text-primary-500 hover:underline inline-flex items-center gap-1"
                            >
                              {pl.commitSha.slice(0, 8)}
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                          </td>
                          <td className="py-2.5 px-5 text-muted">{pl.branch}</td>
                          <td className="py-2.5 px-5">
                            <StatusBadge status={pl.status} />
                          </td>
                          <td className="py-2.5 px-5 text-right text-muted text-xs">
                            {timeAgo(pl.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}