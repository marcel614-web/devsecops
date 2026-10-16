import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { reportService } from "@/services/report.service";
import { projectService } from "@/services/project.service";
import { getErrorMessage } from "@/services/api";
import { useQuery } from "@tanstack/react-query";
import { FileText, Download } from "lucide-react";
import { formatDuration, timeAgo } from "@/lib/utils";

export function ReportsPage() {
  const [projectId, setProjectId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: projects } = useQuery({
    queryKey: ["projects-list"],
    queryFn: () => projectService.list({ pageSize: 100 }),
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["reports", projectId],
    queryFn: () => reportService.list({ pageSize: 50, projectId: projectId || undefined }),
  });

  const { data: detail } = useQuery({
    queryKey: ["report-detail", selectedId],
    queryFn: () => (selectedId ? reportService.get(selectedId) : null),
    enabled: !!selectedId,
  });

  const items = data?.items ?? [];

  const downloadJson = () => {
    if (!detail) return;
    const blob = new Blob([JSON.stringify(detail?.summaryJson ?? detail, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${selectedId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader title="Rapports" description="Rapports de sécurité générés par les pipelines" />

      <div className="mb-4 max-w-md">
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Tous les projets</option>
          {projects?.items?.map((p: any) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </CardContent>
        </Card>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les rapports"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState icon={FileText} title="Aucun rapport" description="Les pipelines terminés génèrent des rapports ici." />
      )}

      {!isLoading && !isError && items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-muted border-b border-border">
                <tr>
                  <th className="text-left py-2 px-4 font-medium">Projet</th>
                  <th className="text-left py-2 px-4 font-medium">Pipeline</th>
                  <th className="text-left py-2 px-4 font-medium">Date</th>
                  <th className="text-right py-2 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 px-4">{r.project?.name ?? r.projectId}</td>
                    <td className="py-2.5 px-4 font-mono text-xs">{r.pipeline?.commitSha?.slice(0, 10) ?? r.pipelineId}</td>
                    <td className="py-2.5 px-4 text-muted">{timeAgo(r.createdAt)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setSelectedId(r.id)}>
                        Voir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {selectedId && detail && (
        <ReportDetailView
          detail={detail as any}
          onClose={() => setSelectedId(null)}
          onDownload={downloadJson}
        />
      )}
    </div>
  );
}
function ReportDetailView({ detail, onClose, onDownload }: { detail: any; onClose: () => void; onDownload: () => void }) {
  const s = detail?.summaryJson ?? detail ?? {};
  const [showRaw, setShowRaw] = useState(false);

  const totals = s.totals ?? {};
  const scans = (s.scans ?? []) as any[];
  const topFindings = (s.topFindings ?? []) as any[];

  const buildHtml = () => {
    const esc = (v: any) => String(v ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rows = scans
      .map((sc: any) => `<tr><td>${esc(sc.scanner)}</td><td>${esc(sc.status)}</td><td>${sc.critical}</td><td>${sc.high}</td><td>${sc.medium}</td><td>${sc.low}</td><td>${formatDuration(sc.durationMs)}</td></tr>`)
      .join("");
    const findings = topFindings
      .map((f: any) => `<tr><td>${esc(f.severity)}</td><td>${esc(f.tool)}</td><td>${esc(f.packageName ?? f.filePath ?? "—")}</td><td>${esc(f.description ?? "—")}</td></tr>`)
      .join("");
    return `<!doctype html><html><head><meta charset="UTF-8"><title>Rapport de sécurité</title><style>body{font-family:Arial,sans-serif;padding:24px;}h1{color:#1e293b;}table{width:100%;border-collapse:collapse;margin:12px 0;}th,td{border:1px solid #cbd5e1;padding:6px;font-size:12px;}th{background:#e2e8f0;} .tot span{display:inline-block;margin:4px;padding:4px 8px;border-radius:4px;background:#f1f5f9;}</style></head><body><h1>Rapport de sécurité</h1><p><strong>Projet :</strong> ${esc(s.project?.name ?? s.project?.id)}</p><p><strong>Pipeline :</strong> ${esc(s.pipeline?.commitSha)} (${esc(s.pipeline?.status)})</p><p><strong>Généré le :</strong> ${esc(s.generatedAt)}</p><div class="tot"><span>Critical: ${totals.critical ?? 0}</span><span>High: ${totals.high ?? 0}</span><span>Medium: ${totals.medium ?? 0}</span><span>Low: ${totals.low ?? 0}</span><span>Info: ${totals.info ?? 0}</span></div>${s.gate ? `<p><strong>Security Gate :</strong> ${esc(s.gate.status)} ${s.gate.blocked ? "(bloqué)" : "(OK)"} ${esc(s.gate.reason ?? "")}</p>` : ""}<h2>Scans</h2><table><thead><tr><th>Scanner</th><th>Statut</th><th>C</th><th>H</th><th>M</th><th>L</th><th>Durée</th></tr></thead><tbody>${rows}</tbody></table><h2>Top findings</h2><table><thead><tr><th>Sév.</th><th>Outil</th><th>Package/Fichier</th><th>Description</th></tr></thead><tbody>${findings}</tbody></table></body></html>`;
  };

  const downloadHtml = () => {
    const blob = new Blob([buildHtml()], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${detail?.id ?? "export"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(buildHtml());
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <Card className="mt-6">
      <CardContent className="space-y-4 py-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Rapport de s�curit�</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onDownload}>
              <Download className="w-4 h-4" /> JSON
            </Button>
            <Button size="sm" variant="ghost" onClick={downloadHtml}>
              <Download className="w-4 h-4" /> HTML
            </Button>
            <Button size="sm" variant="ghost" onClick={printReport}>
              Imprimer/PDF
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted">Projet</p>
            <p className="font-medium">{s.project?.name ?? "�"}</p>
            <p className="text-xs text-muted">{s.project?.repoFullName}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Pipeline</p>
            <p className="font-mono text-xs">{s.pipeline?.commitSha?.slice(0, 12) ?? "�"}</p>
            <p className="text-xs text-muted">Statut : {s.pipeline?.status ?? "�"}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Dur�e totale</p>
            <p className="font-medium">{formatDuration(s.pipeline?.durationMs)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">G�n�r� le</p>
            <p className="font-medium">{s.generatedAt ? new Date(s.generatedAt).toLocaleString() : "�"}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <span className="px-2 py-1 rounded bg-red-600/15 text-red-600 text-xs">Critical: {totals.critical ?? 0}</span>
          <span className="px-2 py-1 rounded bg-orange-600/15 text-orange-600 text-xs">High: {totals.high ?? 0}</span>
          <span className="px-2 py-1 rounded bg-amber-500/15 text-amber-600 text-xs">Medium: {totals.medium ?? 0}</span>
          <span className="px-2 py-1 rounded bg-yellow-300/15 text-yellow-700 text-xs">Low: {totals.low ?? 0}</span>
          <span className="px-2 py-1 rounded bg-slate-500/15 text-slate-600 text-xs">Info: {totals.info ?? 0}</span>
        </div>

        {s.gate && (
          <div>
            <p className="text-sm font-medium mb-1">Security Gate</p>
            <p className="text-xs">
              Statut: {s.gate.status} {s.gate.blocked ? "(bloqu�)" : "(OK)"} {s.gate.reason ? `� ${s.gate.reason}` : ""}
            </p>
          </div>
        )}

        {scans.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">Scans</p>
            <table className="w-full text-xs">
              <thead className="text-muted border-b border-border">
                <tr>
                  <th className="text-left py-1 px-2">Scanner</th>
                  <th className="text-left py-1 px-2">Statut</th>
                  <th className="text-right py-1 px-2">C</th>
                  <th className="text-right py-1 px-2">H</th>
                  <th className="text-right py-1 px-2">M</th>
                  <th className="text-right py-1 px-2">L</th>
                  <th className="text-right py-1 px-2">Dur�e</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((sc: any, i: number) => (
                  <tr key={i} className="border-b border-border/60">
                    <td className="py-1 px-2">{sc.scanner}</td>
                    <td className="py-1 px-2">{sc.status}</td>
                    <td className="py-1 px-2 text-right">{sc.critical}</td>
                    <td className="py-1 px-2 text-right">{sc.high}</td>
                    <td className="py-1 px-2 text-right">{sc.medium}</td>
                    <td className="py-1 px-2 text-right">{sc.low}</td>
                    <td className="py-1 px-2 text-right">{formatDuration(sc.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(s.dockerImage || s.deployment) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {s.dockerImage && (
              <div>
                <p className="text-xs text-muted">Image Docker</p>
                <p className="font-mono text-xs">{s.dockerImage.imageTag}</p>
              </div>
            )}
            {s.deployment && (
              <div>
                <p className="text-xs text-muted">D�ploiement</p>
                <p className="text-xs">{s.deployment.status} {s.deployment.url ? `� ${s.deployment.url}` : ""}</p>
              </div>
            )}
          </div>
        )}

        {topFindings.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">Top findings ({topFindings.length})</p>
            <table className="w-full text-xs">
              <thead className="text-muted border-b border-border">
                <tr>
                  <th className="text-left py-1 px-2">Sev.</th>
                  <th className="text-left py-1 px-2">Outil</th>
                  <th className="text-left py-1 px-2">Package / Fichier</th>
                  <th className="text-left py-1 px-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {topFindings.map((f: any, i: number) => (
                  <tr key={i} className="border-b border-border/60">
                    <td className="py-1 px-2">{f.severity}</td>
                    <td className="py-1 px-2">{f.tool}</td>
                    <td className="py-1 px-2">{f.packageName ?? f.filePath ?? "�"}</td>
                    <td className="py-1 px-2 truncate max-w-xs">{f.description ?? "�"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Button size="sm" variant="ghost" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? "Masquer le JSON brut" : "Afficher le JSON brut"}
        </Button>
        {showRaw && (
          <pre className="text-xs max-h-96 overflow-auto bg-slate-100 dark:bg-slate-900 p-3 rounded">
            {JSON.stringify(s, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
