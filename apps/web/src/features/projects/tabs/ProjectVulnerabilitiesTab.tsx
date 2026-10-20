import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { SeverityBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { vulnerabilityService } from "@/services/vulnerability.service";
import { timeAgo, cn } from "@/lib/utils";

const SEV_STYLE: Record<string, string> = {
  CRITICAL: "text-red-600 dark:text-red-400 border-red-500/40 bg-red-500/10",
  HIGH: "text-orange-600 dark:text-orange-400 border-orange-500/40 bg-orange-500/10",
  MEDIUM: "text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10",
  LOW: "text-blue-600 dark:text-blue-400 border-blue-500/40 bg-blue-500/10",
  INFO: "text-slate-500 border-slate-400/40 bg-slate-500/10",
};

export function ProjectVulnerabilitiesTab({ projectId }: { projectId: string }) {
  const [sev, setSev] = useState<string | null>(null);
  const [tool, setTool] = useState<string>("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["project-vulnerabilities", projectId],
    queryFn: () => vulnerabilityService.listByProject(projectId, { pageSize: 50 }),
  });

  const tools = useMemo(() => Array.from(new Set(data?.items.map((v) => v.tool) ?? [])), [data]);
  const items = useMemo(
    () => (data?.items ?? []).filter((v) => (!sev || String(v.severity).toUpperCase() === sev) && (!tool || v.tool === tool)),
    [data, sev, tool],
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        title="Impossible de charger les vulnérabilités"
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  const keys = Object.keys(data.severityCounts) as Array<keyof typeof data.severityCounts>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {keys.map((k) => {
          const key = String(k).toUpperCase();
          const selected = sev === key;
          return (
            <button
              key={String(k)}
              type="button"
              aria-pressed={selected}
              onClick={() => setSev(selected ? null : key)}
              className={cn(
                "rounded-xl border p-4 text-left transition focus-visible:ring-2 focus-visible:ring-primary-500",
                SEV_STYLE[key] ?? SEV_STYLE.INFO,
                selected ? "ring-2 ring-current" : "opacity-90 hover:opacity-100",
              )}
            >
              <p className="text-2xl font-bold tabular-nums leading-none">{data.severityCounts[k]}</p>
              <p className="mt-1.5 text-xs font-medium capitalize">{String(k).toLowerCase()}</p>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <p className="text-sm text-muted tabular-nums">
              {items.length} findings uniques
              {(sev || tool) && (
                <button type="button" className="ml-3 text-primary-500 hover:underline" onClick={() => { setSev(null); setTool(""); }}>
                  Réinitialiser les filtres
                </button>
              )}
            </p>
            <div className="flex items-center gap-2">
              {tools.length > 1 && (
                <select
                  value={tool}
                  onChange={(e) => setTool(e.target.value)}
                  aria-label="Filtrer par outil"
                  className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
                >
                  <option value="">Tous les outils</option>
                  {tools.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              <Link
                to={`/vulnerabilities?projectId=${projectId}`}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                Gérer <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {items.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title={data.items.length === 0 ? "Aucune vulnérabilité détectée" : "Aucun résultat pour ces filtres"}
              description={data.items.length === 0 ? "Lancez un pipeline pour analyser le projet." : "Modifiez ou réinitialisez les filtres."}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-slate-50/60 text-xs text-muted dark:bg-slate-800/30">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Sévérité</th>
                    <th className="px-4 py-2.5 text-left font-medium">Outil</th>
                    <th className="px-4 py-2.5 text-left font-medium">Package / fichier</th>
                    <th className="px-4 py-2.5 text-left font-medium">Description</th>
                    <th className="px-4 py-2.5 text-left font-medium">Statut</th>
                    <th className="px-4 py-2.5 text-right font-medium">Occ.</th>
                    <th className="px-4 py-2.5 text-right font-medium">Dernière détection</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((v) => {
                    const target = v.packageName ?? v.filePath?.split(/[\\/]/).pop() ?? "—";
                    return (
                      <tr key={v.id} className="border-b border-border/60 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30">
                        <td className="px-4 py-3"><SeverityBadge severity={v.severity} /></td>
                        <td className="px-4 py-3 text-xs text-muted">{v.tool}</td>
                        <td className="px-4 py-3 font-mono text-xs" title={v.filePath ?? v.packageName ?? ""}>{target}</td>
                        <td className="max-w-md px-4 py-3">
                          {v.reference ? (
                            <a href={v.reference} target="_blank" rel="noopener noreferrer" className="block truncate hover:text-primary-500 hover:underline" title={v.description ?? ""}>
                              {v.description}
                            </a>
                          ) : (
                            <span className="block truncate" title={v.description ?? ""}>{v.description}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs">
                          {v.status === "FIXED"
                            ? "Corrigée"
                            : v.status === "FALSE_POSITIVE"
                              ? "Faux positif"
                              : v.status === "RISK_ACCEPTED"
                                ? "Risque accepté"
                                : v.status === "DUPLICATE"
                                  ? "Doublon"
                                  : v.status === "CONFIRMED"
                                    ? "Confirmée"
                                    : "Ouverte"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-xs tabular-nums">×{v.occurrences}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-muted">{timeAgo(v.detectedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
