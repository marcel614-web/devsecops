// apps/web/src/features/vulnerabilities/VulnerabilitiesPage.tsx
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ExternalLink, ShieldAlert } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { SeverityBadge } from "@/components/ui/Badge";
import { SeveritySummaryCards } from "@/components/security/SeveritySummaryCards";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { projectService } from "@/services/project.service";
import { vulnerabilityService } from "@/services/vulnerability.service";
import { timeAgo } from "@/lib/utils";
import type { Severity } from "@/types/api";

const TOOLS = [
  { value: "", label: "Tous les outils" },
  { value: "gitleaks", label: "Gitleaks" },
  { value: "semgrep", label: "Semgrep" },
  { value: "npm-audit", label: "npm audit" },
  { value: "trivy", label: "Trivy" },
];

export function VulnerabilitiesPage() {
  const [params, setParams] = useSearchParams();

  const projectId = params.get("projectId") ?? "";
  const severity = (params.get("severity") ?? "") as Severity | "";
  const tool = params.get("tool") ?? "";
  const search = params.get("search") ?? "";
  const page = Number(params.get("page") ?? 1);

  const { data: projects } = useQuery({
    queryKey: ["projects-list"],
    queryFn: () => projectService.list({ pageSize: 100 }),
  });

  const effectiveProjectId = projectId || projects?.items[0]?.id || "";

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["vulnerabilities", effectiveProjectId, { severity, tool, search, page }],
    queryFn: () =>
      vulnerabilityService.listByProject(effectiveProjectId, {
        page,
        pageSize: 25,
        severity: severity || undefined,
        tool: tool || undefined,
        search: search || undefined,
      }),
    enabled: !!effectiveProjectId,
  });

  const updateParams = (updates: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    setParams(next);
  };

  return (
    <div>
      <PageHeader
        title="Vulnérabilités"
        description="Toutes les vulnérabilités détectées par les scanners"
      />

      {/* Filtre projet */}
      <Card className="mb-4">
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 py-4">
          <Select
            value={effectiveProjectId}
            onChange={(e) => updateParams({ projectId: e.target.value, page: 1 })}
          >
            {projects?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>

          <Select
            value={tool}
            onChange={(e) => updateParams({ tool: e.target.value, page: 1 })}
          >
            {TOOLS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>

          <div className="md:col-span-2">
            <Input
              value={search}
              onChange={(e) => updateParams({ search: e.target.value, page: 1 })}
              placeholder="Rechercher un package, fichier ou CVE…"
            />
          </div>
        </CardContent>
      </Card>

      {/* Compteurs par sévérité */}
      {data && (
        <div className="mb-6">
          <SeveritySummaryCards
            counts={data.severityCounts}
            active={severity || null}
            onSelect={(s) => updateParams({ severity: s ?? "", page: 1 })}
          />
        </div>
      )}

      {/* Tableau */}
      {isLoading && (
        <Card>
          <CardContent className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </CardContent>
        </Card>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les vulnérabilités"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={ShieldAlert}
          title="Aucune vulnérabilité"
          description={
            search || severity || tool
              ? "Aucun résultat pour ces filtres."
              : "Lance un pipeline pour analyser le projet."
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted border-b border-border">
                    <tr>
                      <th className="text-left py-2 px-4 font-medium">Sévérité</th>
                      <th className="text-left py-2 px-4 font-medium">Outil</th>
                      <th className="text-left py-2 px-4 font-medium">Package / Fichier</th>
                      <th className="text-left py-2 px-4 font-medium">Version</th>
                      <th className="text-left py-2 px-4 font-medium">Description</th>
                      <th className="text-right py-2 px-4 font-medium">Détecté</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((v) => (
                      <tr
                        key={v.id}
                        className="border-b border-border/60 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30"
                      >
                        <td className="py-2.5 px-4">
                          <SeverityBadge severity={v.severity} />
                        </td>
                        <td className="py-2.5 px-4 text-xs text-muted">{v.tool}</td>
                        <td className="py-2.5 px-4 font-mono text-xs">
                          {v.packageName ?? v.filePath?.split("\\").pop() ?? "—"}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-xs">
                          {v.version ?? "—"}
                          {v.fixedVersion && (
                            <span className="text-emerald-500 ml-1">
                              → {v.fixedVersion}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 max-w-md">
                          {v.reference ? (
                            <a
                              href={v.reference}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-primary-500 inline-flex items-center gap-1 truncate max-w-full"
                              title={v.description ?? ""}
                            >
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span className="truncate">{v.description}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          ) : (
                            <span className="truncate block">{v.description}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right text-xs text-muted">
                          {timeAgo(v.detectedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onPage={(p) => updateParams({ page: p })}
          />
        </>
      )}
    </div>
  );
}