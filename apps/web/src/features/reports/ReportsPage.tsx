// src/pages/ReportsPage.tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Download,
  RefreshCw,
  Printer,
  Search,
  X,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { reportService } from "@/services/report.service";
import { projectService } from "@/services/project.service";
import { formatDuration, timeAgo, cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Styles de sévérité partagés (tableau + détail)
// ---------------------------------------------------------------------------
const SEVERITY_CHIPS = [
  { key: "critical", label: "Critiques", className: "bg-red-600/15 text-red-600 dark:text-red-400" },
  { key: "high", label: "Élevées", className: "bg-orange-600/15 text-orange-600 dark:text-orange-400" },
  { key: "medium", label: "Moyennes", className: "bg-amber-500/15 text-amber-600 dark:text-amber-500" },
  { key: "low", label: "Faibles", className: "bg-yellow-300/20 text-yellow-700 dark:text-yellow-500" },
  { key: "info", label: "Info", className: "bg-slate-500/15 text-slate-600 dark:text-slate-400" },
] as const;

// ---------------------------------------------------------------------------
// Page principale
// ---------------------------------------------------------------------------
export function ReportsPage() {
  const [projectId, setProjectId] = useState("");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: projects } = useQuery({
    queryKey: ["projects-list"],
    queryFn: () => projectService.list({ pageSize: 100 }),
  });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["reports", projectId],
    queryFn: () =>
      reportService.list({ pageSize: 50, projectId: projectId || undefined }),
  });

  const { data: detail } = useQuery({
    queryKey: ["report-detail", selectedId],
    queryFn: () => (selectedId ? reportService.get(selectedId) : null),
    enabled: !!selectedId,
  });

  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.items ?? []).filter((r: any) => {
      if (!term) return true;
      return (
        (r.project?.name ?? "").toLowerCase().includes(term) ||
        (r.project?.repoFullName ?? "").toLowerCase().includes(term) ||
        (r.pipeline?.commitSha ?? "").toLowerCase().includes(term)
      );
    });
  }, [data, q]);

  const filtered = !!q || !!projectId;

  const downloadJson = () => {
    if (!detail) return;
    const payload = (detail as any).summaryJson ?? detail;
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${selectedId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rapports"
        description="Rapports de sécurité générés par les pipelines"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Rafraîchir
          </Button>
        }
      />

      {/* Filtres */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {projects && projects.items.length > 0 && (
          <div className="w-full lg:max-w-sm">
            <Select
              aria-label="Projet"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setSelectedId(null);
              }}
            >
              <option value="">Tous les projets</option>
              {projects.items.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.repoFullName}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Projet, dépôt, commit…"
            aria-label="Rechercher un rapport"
            className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
          />
        </div>

        {data && (
          <p className="text-sm tabular-nums text-muted lg:ml-auto" aria-live="polite">
            {items.length} sur {data.total ?? items.length} rapport
            {(data.total ?? items.length) > 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Chargement */}
      {isLoading && (
        <Card>
          <CardContent className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Erreur */}
      {isError && (
        <ErrorState
          title="Impossible de charger les rapports"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {/* Vide */}
      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={FileText}
          title={filtered ? "Aucun résultat" : "Aucun rapport"}
          description={
            filtered
              ? "Aucun rapport ne correspond à ces filtres."
              : "Les pipelines terminés génèrent des rapports ici."
          }
          action={
            filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setQ("");
                  setProjectId("");
                }}
              >
                Réinitialiser les filtres
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Tableau */}
      {!isLoading && !isError && items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-slate-50/60 text-xs text-muted dark:bg-slate-800/30">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Projet</th>
                    <th className="px-4 py-2.5 text-left font-medium">Pipeline</th>
                    <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">
                      Gravité
                    </th>
                    <th className="hidden px-4 py-2.5 text-left font-medium lg:table-cell">
                      Security Gate
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="w-32 px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r: any) => {
                    const s = r.summaryJson ?? {};
                    const totals = s.totals ?? {};
                    const gate = s.gate;
                    const critical = totals.critical ?? 0;
                    const high = totals.high ?? 0;
                    const isSelected = selectedId === r.id;

                    return (
                      <tr
                        key={r.id}
                        className={cn(
                          "border-b border-border/60 transition-colors last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30",
                          isSelected && "bg-primary-600/5",
                        )}
                      >
                        <td className="px-4 py-3">
                          <p className="truncate font-medium">
                            {r.project?.name ?? r.projectId}
                          </p>
                          <p className="truncate font-mono text-xs text-muted">
                            {r.project?.repoFullName ?? ""}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded bg-slate-200/60 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-700/60">
                            {r.pipeline?.commitSha?.slice(0, 7) ?? r.pipelineId}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">
                          {critical > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded bg-red-600/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                              <ShieldAlert className="h-3 w-3" />
                              {critical} critique{critical > 1 ? "s" : ""}
                            </span>
                          ) : high > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded bg-orange-600/15 px-2 py-0.5 text-xs font-medium text-orange-600 dark:text-orange-400">
                              {high} élevée{high > 1 ? "s" : ""}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              <ShieldCheck className="h-3 w-3" />
                              Aucune
                            </span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 lg:table-cell">
                          {gate ? (
                            <span
                              className={cn(
                                "rounded px-2 py-0.5 text-xs font-medium",
                                gate.blocked
                                  ? "bg-red-600/15 text-red-600 dark:text-red-400"
                                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {gate.blocked ? "Bloqué" : gate.status ?? "OK"}
                            </span>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted">
                          {timeAgo(r.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant={isSelected ? "ghost" : "secondary"}
                            onClick={() => setSelectedId(isSelected ? null : r.id)}
                            className="gap-1.5"
                          >
                            {isSelected ? (
                              <>
                                <X className="h-3.5 w-3.5" /> Fermer
                              </>
                            ) : (
                              "Voir"
                            )}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Détail */}
      {selectedId && detail && (
        <ReportDetailView
          detail={detail as any}
          onClose={() => setSelectedId(null)}
          onDownloadJson={downloadJson}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vue détail d'un rapport
// ---------------------------------------------------------------------------
function ReportDetailView({
  detail,
  onClose,
  onDownloadJson,
}: {
  detail: any;
  onClose: () => void;
  onDownloadJson: () => void;
}) {
  const s = detail?.summaryJson ?? detail ?? {};
  const [showRaw, setShowRaw] = useState(false);

  const totals = s.totals ?? {};
  const scans = (s.scans ?? []) as any[];
  const topFindings = (s.topFindings ?? []) as any[];

  const buildHtml = () => {
    const esc = (v: any) =>
      String(v ?? "")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const rows = scans
      .map(
        (sc: any) =>
          `<tr><td>${esc(sc.scanner)}</td><td>${esc(sc.status)}</td><td>${sc.critical}</td><td>${sc.high}</td><td>${sc.medium}</td><td>${sc.low}</td><td>${formatDuration(sc.durationMs)}</td></tr>`,
      )
      .join("");
    const findings = topFindings
      .map(
        (f: any) =>
          `<tr><td>${esc(f.severity)}</td><td>${esc(f.tool)}</td><td>${esc(f.packageName ?? f.filePath ?? "—")}</td><td>${esc(f.description ?? "—")}</td></tr>`,
      )
      .join("");
    return `<!doctype html><html><head><meta charset="UTF-8"><title>Rapport de sécurité</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a;}h1{color:#1e293b;}table{width:100%;border-collapse:collapse;margin:12px 0;}th,td{border:1px solid #cbd5e1;padding:6px;font-size:12px;}th{background:#e2e8f0;} .tot span{display:inline-block;margin:4px;padding:4px 8px;border-radius:4px;background:#f1f5f9;}</style></head><body><h1>Rapport de sécurité</h1><p><strong>Projet :</strong> ${esc(s.project?.name ?? s.project?.id)}</p><p><strong>Pipeline :</strong> ${esc(s.pipeline?.commitSha)} (${esc(s.pipeline?.status)})</p><p><strong>Généré le :</strong> ${esc(s.generatedAt)}</p><div class="tot"><span>Critical: ${totals.critical ?? 0}</span><span>High: ${totals.high ?? 0}</span><span>Medium: ${totals.medium ?? 0}</span><span>Low: ${totals.low ?? 0}</span><span>Info: ${totals.info ?? 0}</span></div>${s.gate ? `<p><strong>Security Gate :</strong> ${esc(s.gate.status)} ${s.gate.blocked ? "(bloqué)" : "(OK)"} ${esc(s.gate.reason ?? "")}</p>` : ""}<h2>Scans</h2><table><thead><tr><th>Scanner</th><th>Statut</th><th>C</th><th>H</th><th>M</th><th>L</th><th>Durée</th></tr></thead><tbody>${rows}</tbody></table><h2>Top findings</h2><table><thead><tr><th>Sév.</th><th>Outil</th><th>Package/Fichier</th><th>Description</th></tr></thead><tbody>${findings}</tbody></table></body></html>`;
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

  // Bandeau coloré à gauche selon la gravité la plus haute
  const leftBar =
    (totals.critical ?? 0) > 0
      ? "before:bg-red-600"
      : (totals.high ?? 0) > 0
      ? "before:bg-orange-600"
      : (totals.medium ?? 0) > 0
      ? "before:bg-amber-500"
      : "before:bg-emerald-500";

  return (
    <Card
      className={cn(
        "relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
        leftBar,
      )}
    >
      <CardContent className="space-y-5 p-6">
        {/* En-tête */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Rapport de sécurité</h3>
            <p className="text-xs text-muted">
              {s.project?.name ?? "—"}
              {s.pipeline?.commitSha
                ? ` · ${String(s.pipeline.commitSha).slice(0, 7)}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={onDownloadJson} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> JSON
            </Button>
            <Button size="sm" variant="secondary" onClick={downloadHtml} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> HTML
            </Button>
            <Button size="sm" variant="secondary" onClick={printReport} className="gap-1.5">
              <Printer className="h-3.5 w-3.5" /> Imprimer / PDF
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose} className="gap-1.5">
              <X className="h-3.5 w-3.5" /> Fermer
            </Button>
          </div>
        </div>

        {/* Métadonnées */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Meta label="Projet" value={s.project?.name ?? "—"} sub={s.project?.repoFullName} />
          <Meta
            label="Pipeline"
            value={s.pipeline?.commitSha?.slice(0, 12) ?? "—"}
            sub={s.pipeline?.status ? `Statut : ${s.pipeline.status}` : undefined}
            mono
          />
          <Meta label="Durée totale" value={formatDuration(s.pipeline?.durationMs)} />
          <Meta
            label="Généré le"
            value={s.generatedAt ? new Date(s.generatedAt).toLocaleString() : "—"}
          />
        </div>

        {/* Chips sévérité */}
        <div className="flex flex-wrap gap-2">
          {SEVERITY_CHIPS.map((c) => (
            <span
              key={c.key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                c.className,
              )}
            >
              <span>{c.label}</span>
              <span className="tabular-nums opacity-80">{totals[c.key] ?? 0}</span>
            </span>
          ))}
        </div>

        {/* Security Gate */}
        {s.gate && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 text-sm",
              s.gate.blocked
                ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
                : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
            )}
          >
            {s.gate.blocked ? (
              <ShieldAlert className="h-4 w-4 shrink-0" />
            ) : (
              <ShieldCheck className="h-4 w-4 shrink-0" />
            )}
            <span className="font-medium">Security Gate · {s.gate.status}</span>
            {s.gate.reason && (
              <span className="text-xs opacity-80">— {s.gate.reason}</span>
            )}
          </div>
        )}

        {/* Scans */}
        {scans.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Scans</p>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-slate-50/60 text-muted dark:bg-slate-800/30">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Scanner</th>
                    <th className="px-3 py-2 text-left font-medium">Statut</th>
                    <th className="px-3 py-2 text-right font-medium">C</th>
                    <th className="px-3 py-2 text-right font-medium">H</th>
                    <th className="px-3 py-2 text-right font-medium">M</th>
                    <th className="px-3 py-2 text-right font-medium">L</th>
                    <th className="px-3 py-2 text-right font-medium">Durée</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((sc: any, i: number) => (
                    <tr
                      key={i}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-3 py-2 font-medium">{sc.scanner}</td>
                      <td className="px-3 py-2 text-muted">{sc.status}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sc.critical}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sc.high}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sc.medium}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sc.low}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {formatDuration(sc.durationMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Docker / Déploiement */}
        {(s.dockerImage || s.deployment) && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {s.dockerImage && (
              <Meta label="Image Docker" value={s.dockerImage.imageTag} mono />
            )}
            {s.deployment && (
              <Meta
                label="Déploiement"
                value={s.deployment.status}
                sub={s.deployment.url}
              />
            )}
          </div>
        )}

        {/* Top findings */}
        {topFindings.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">
              Top findings <span className="text-muted">({topFindings.length})</span>
            </p>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-slate-50/60 text-muted dark:bg-slate-800/30">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Sév.</th>
                    <th className="px-3 py-2 text-left font-medium">Outil</th>
                    <th className="px-3 py-2 text-left font-medium">Package / Fichier</th>
                    <th className="px-3 py-2 text-left font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {topFindings.map((f: any, i: number) => (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 font-medium">{f.severity}</td>
                      <td className="px-3 py-2">
                        <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[11px] text-muted dark:bg-slate-700/60">
                          {f.tool}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {f.packageName ?? f.filePath ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="line-clamp-2 max-w-md">{f.description ?? "—"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* JSON brut */}
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowRaw((v) => !v)}
            className="gap-1.5"
          >
            {showRaw ? "Masquer le JSON brut" : "Afficher le JSON brut"}
          </Button>
          {showRaw && (
            <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-border/60 bg-slate-100 p-3 text-xs dark:bg-slate-900">
              {JSON.stringify(s, null, 2)}
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Petit composant de métadonnée
// ---------------------------------------------------------------------------
function Meta({
  label,
  value,
  sub,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-100/60 px-3 py-2.5 dark:bg-slate-800/40">
      <p className="mb-1 text-xs text-muted">{label}</p>
      <p
        className={cn(
          "truncate text-sm font-medium",
          mono && "font-mono text-xs",
        )}
        title={value}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
    </div>
  );
}