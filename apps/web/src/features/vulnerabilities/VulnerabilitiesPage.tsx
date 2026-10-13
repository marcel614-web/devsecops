import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { projectsApi } from "@/services/projects.api";
import { vulnerabilitiesApi } from "@/services/vulnerabilities.api";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { SeverityBadge } from "@/components/SeverityBadge";
import { timeAgo } from "@/utils/format";
import type { Severity } from "@/types/api";

export function VulnerabilitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get("projectId") ?? "";
  const severity = (searchParams.get("severity") ?? "") as Severity | "";
  const tool = searchParams.get("tool") ?? "";
  const search = searchParams.get("search") ?? "";

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => projectsApi.list({ pageSize: 100 }),
  });

  // Auto-sélectionne le premier projet si aucun n'est choisi
  const effectiveProjectId = projectId || projects?.items[0]?.id || "";

  const { data, isLoading } = useQuery({
    queryKey: ["vulns", effectiveProjectId, severity, tool, search],
    queryFn: () => vulnerabilitiesApi.list(effectiveProjectId, {
      pageSize: 50,
      severity: severity || undefined,
      tool: tool || undefined,
      search: search || undefined,
    }),
    enabled: !!effectiveProjectId,
  });

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Vulnérabilités</h1>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const).map((s) => (
            <Card key={s} className="text-center">
              <p className="text-xs text-slate-400">{s}</p>
              <p className="text-2xl font-bold">{data.severityCounts[s]}</p>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select value={effectiveProjectId} onChange={(e) => update("projectId", e.target.value)}>
            {projects?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select value={severity} onChange={(e) => update("severity", e.target.value)}>
            <option value="">Toutes sévérités</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </Select>
          <Select value={tool} onChange={(e) => update("tool", e.target.value)}>
            <option value="">Tous outils</option>
            <option value="trivy">trivy</option>
            <option value="npm-audit">npm-audit</option>
            <option value="semgrep">semgrep</option>
            <option value="gitleaks">gitleaks</option>
          </Select>
          <Input placeholder="Rechercher…" value={search} onChange={(e) => update("search", e.target.value)} />
        </div>
      </Card>

      {isLoading && <p>Chargement…</p>}

      {data && (
        <Card>
          <p className="text-sm text-slate-400 mb-3">{data.total} résultat(s)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400 border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2">Sévérité</th>
                  <th className="text-left py-2 px-2">Outil</th>
                  <th className="text-left py-2 px-2">Package / Fichier</th>
                  <th className="text-left py-2 px-2">Version</th>
                  <th className="text-left py-2 px-2">Description</th>
                  <th className="text-right py-2 px-2">Détecté</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((v) => (
                  <tr key={v.id} className="border-b border-border/50 hover:bg-slate-800/40">
                    <td className="py-2 px-2"><SeverityBadge severity={v.severity} /></td>
                    <td className="py-2 px-2 text-xs">{v.tool}</td>
                    <td className="py-2 px-2 font-mono text-xs">{v.packageName ?? v.filePath?.split("\\").pop() ?? "-"}</td>
                    <td className="py-2 px-2 font-mono text-xs">{v.version ?? "-"}</td>
                    <td className="py-2 px-2 text-slate-300 max-w-md truncate">
                      {v.reference ? (
                        <a href={v.reference} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                          {v.description}
                        </a>
                      ) : v.description}
                    </td>
                    <td className="py-2 px-2 text-right text-xs text-slate-500">{timeAgo(v.detectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}