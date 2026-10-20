// apps/worker/src/steps/report/report.generator.ts
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";

export interface ReportScanSummary {
  scanner: string;
  status: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  durationMs: number | null;
}

export interface ReportTopFinding {
  tool: string;
  severity: string;
  packageName: string | null;
  filePath: string | null;
  description: string | null;
  reference: string | null;
}

export interface ReportSummary {
  generatedAt: string;
  project: {
    id: string;
    name: string;
    repoFullName: string;
    technology: string;
  };
  pipeline: {
    id: string;
    commitSha: string;
    branch: string;
    author: string;
    trigger: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    pullRequestNumber?: number | null;
  };
  scans: ReportScanSummary[];
  totals: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  gate: {
    status: string;
    mode?: string;
    blocked: boolean;
    reason: string | null;
    rules?: unknown;
  } | null;
  dockerImage: {
    imageTag: string;
    imageId: string | null;
    signed?: boolean;
  } | null;
  sbom: {
    packageCount: number;
    format: string;
  } | null;
  deployment: {
    status: string;
    environment?: string;
    url: string | null;
    releaseVersion: string | null;
  } | null;
  topFindings: ReportTopFinding[];
  vulnerabilityCount: number;
}

// ============================================================
// HELPERS
// ============================================================

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function severityColor(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return "#b91c1c";
    case "HIGH":
      return "#dc2626";
    case "MEDIUM":
      return "#d97706";
    case "LOW":
      return "#2563eb";
    default:
      return "#64748b";
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function reportsDirectory(): string {
  return (
    process.env.REPORTS_DIR?.trim() ||
    path.join(os.tmpdir(), "devsecops-reports")
  );
}

// ============================================================
// HTML
// ============================================================

export function generateHtml(summary: ReportSummary): string {
  const scansRows = summary.scans
    .map(
      (s) => `
        <tr>
          <td>${escapeHtml(s.scanner)}</td>
          <td><span class="badge ${escapeHtml(s.status.toLowerCase())}">${escapeHtml(s.status)}</span></td>
          <td class="num critical">${s.critical}</td>
          <td class="num high">${s.high}</td>
          <td class="num medium">${s.medium}</td>
          <td class="num low">${s.low}</td>
          <td class="num">${s.info}</td>
          <td class="num">${escapeHtml(formatDuration(s.durationMs))}</td>
        </tr>`,
    )
    .join("");

  const findingsRows = summary.topFindings
    .map(
      (f) => `
        <tr>
          <td><span class="badge" style="background:${severityColor(f.severity)}20;color:${severityColor(f.severity)}">${escapeHtml(f.severity)}</span></td>
          <td>${escapeHtml(f.tool)}</td>
          <td>${escapeHtml(f.packageName ?? "—")}</td>
          <td class="mono">${escapeHtml(f.filePath ?? "—")}</td>
          <td>${escapeHtml(f.description ?? "—")}</td>
          <td class="mono">${escapeHtml(f.reference ?? "—")}</td>
        </tr>`,
    )
    .join("");

  const gate = summary.gate;
  const gateColor =
    gate?.status === "PASSED"
      ? "#059669"
      : gate?.status === "WARNING"
        ? "#d97706"
        : "#dc2626";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Rapport DevSecOps — ${escapeHtml(summary.project.name)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; background: #f8fafc; }
  .page { max-width: 1100px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 32px; }
  h1 { margin: 0 0 4px; font-size: 26px; }
  h2 { margin: 32px 0 12px; font-size: 18px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
  .muted { color: #64748b; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 16px; }
  .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; background: #f8fafc; }
  .card .label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
  .card .value { font-size: 18px; font-weight: 700; margin-top: 4px; word-break: break-word; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #475569; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .critical { color: #b91c1c; font-weight: 700; }
  .high { color: #dc2626; font-weight: 600; }
  .medium { color: #d97706; }
  .low { color: #2563eb; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .badge.success, .badge.passed { background: #d1fae5; color: #047857; }
  .badge.warning { background: #fef3c7; color: #b45309; }
  .badge.failed, .badge.blocked, .badge.security_blocked { background: #fee2e2; color: #b91c1c; }
  .banner { border-left: 4px solid ${gateColor}; background: ${gateColor}12; padding: 12px 16px; border-radius: 8px; margin-top: 12px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
  @media print { body { background: #fff; padding: 0; } .page { border: none; border-radius: 0; padding: 0; } }
</style>
</head>
<body>
<div class="page">
  <h1>Rapport de sécurité DevSecOps</h1>
  <p class="muted">Généré le ${escapeHtml(new Date(summary.generatedAt).toLocaleString("fr-FR"))}</p>

  <div class="grid">
    <div class="card"><div class="label">Projet</div><div class="value">${escapeHtml(summary.project.name)}</div><div class="muted">${escapeHtml(summary.project.repoFullName)}</div></div>
    <div class="card"><div class="label">Branche / commit</div><div class="value">${escapeHtml(summary.pipeline.branch)}</div><div class="muted mono">${escapeHtml(summary.pipeline.commitSha)}</div></div>
    <div class="card"><div class="label">Statut pipeline</div><div class="value">${escapeHtml(summary.pipeline.status)}</div><div class="muted">${escapeHtml(formatDuration(summary.pipeline.durationMs))}</div></div>
    <div class="card"><div class="label">Vulnérabilités</div><div class="value">${summary.vulnerabilityCount}</div><div class="muted">${escapeHtml(summary.scans.length)} scanner(s)</div></div>
  </div>

  <h2>Security Gate</h2>
  ${
    gate
      ? `<div class="banner">
          <strong style="color:${gateColor}">${escapeHtml(gate.status)}</strong>
          ${gate.mode ? ` · mode ${escapeHtml(gate.mode)}` : ""}
          ${gate.blocked ? " · déploiement bloqué" : ""}
          ${gate.reason ? `<div class="muted" style="margin-top:6px">${escapeHtml(gate.reason)}</div>` : ""}
        </div>`
      : `<p class="muted">Aucun résultat de gate.</p>`
  }

  <h2>Synthèse par scanner</h2>
  <table>
    <thead><tr><th>Scanner</th><th>Statut</th><th class="num">Crit.</th><th class="num">Élev.</th><th class="num">Moy.</th><th class="num">Faible</th><th class="num">Info</th><th class="num">Durée</th></tr></thead>
    <tbody>${scansRows || `<tr><td colspan="8" class="muted">Aucun scan</td></tr>`}</tbody>
  </table>

  <h2>Totaux</h2>
  <div class="grid">
    <div class="card"><div class="label">Critiques</div><div class="value critical">${summary.totals.critical}</div></div>
    <div class="card"><div class="label">Élevées</div><div class="value high">${summary.totals.high}</div></div>
    <div class="card"><div class="label">Moyennes</div><div class="value medium">${summary.totals.medium}</div></div>
    <div class="card"><div class="label">Faibles</div><div class="value low">${summary.totals.low}</div></div>
    <div class="card"><div class="label">Info</div><div class="value">${summary.totals.info}</div></div>
  </div>

  <h2>Top findings</h2>
  <table>
    <thead><tr><th>Sévérité</th><th>Outil</th><th>Paquet</th><th>Fichier / URL</th><th>Description</th><th>Référence</th></tr></thead>
    <tbody>${findingsRows || `<tr><td colspan="6" class="muted">Aucun finding</td></tr>`}</tbody>
  </table>

  <h2>Chaîne de livraison</h2>
  <table>
    <tbody>
      <tr><th>Image Docker</th><td class="mono">${escapeHtml(summary.dockerImage?.imageTag ?? "—")}</td></tr>
      <tr><th>Image signée (Cosign)</th><td>${summary.dockerImage?.signed ? "Oui" : "Non"}</td></tr>
      <tr><th>SBOM (Syft)</th><td>${summary.sbom ? `${summary.sbom.packageCount} paquet(s) · ${escapeHtml(summary.sbom.format)}` : "Non généré"}</td></tr>
      <tr><th>Déploiement</th><td>${summary.deployment ? `${escapeHtml(summary.deployment.environment ?? "")} · ${escapeHtml(summary.deployment.status)} · ${escapeHtml(summary.deployment.url ?? "—")}` : "—"}</td></tr>
    </tbody>
  </table>

  <div class="footer">
    DevSecOps Manager · pipeline ${escapeHtml(summary.pipeline.id)} · rapport généré automatiquement.
  </div>
</div>
</body>
</html>`;
}

// ============================================================
// PDF
// ============================================================

export async function generatePdf(
  summary: ReportSummary,
  filePath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const stream = fsSync.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(20).fillColor("#0f172a").text("Rapport de sécurité DevSecOps");
    doc.moveDown(0.2);
    doc
      .fontSize(9)
      .fillColor("#64748b")
      .text(`Généré le ${new Date(summary.generatedAt).toLocaleString("fr-FR")}`);
    doc.moveDown(1);

    // Projet / pipeline
    doc.fontSize(13).fillColor("#0f172a").text("Projet");
    doc.fontSize(10).fillColor("#334155");
    doc.text(`${summary.project.name} (${summary.project.repoFullName})`);
    doc.text(`Technologie : ${summary.project.technology}`);
    doc.moveDown(0.6);

    doc.fontSize(13).fillColor("#0f172a").text("Pipeline");
    doc.fontSize(10).fillColor("#334155");
    doc.text(`ID : ${summary.pipeline.id}`);
    doc.text(`Branche : ${summary.pipeline.branch}`);
    doc.text(`Commit : ${summary.pipeline.commitSha}`);
    doc.text(`Auteur : ${summary.pipeline.author}`);
    doc.text(`Déclencheur : ${summary.pipeline.trigger}`);
    doc.text(`Statut : ${summary.pipeline.status}`);
    doc.text(`Durée : ${formatDuration(summary.pipeline.durationMs)}`);
    doc.moveDown(0.6);

    // Gate
    doc.fontSize(13).fillColor("#0f172a").text("Security Gate");
    doc.fontSize(10).fillColor("#334155");
    if (summary.gate) {
      doc.text(`Statut : ${summary.gate.status}`);
      if (summary.gate.mode) doc.text(`Mode : ${summary.gate.mode}`);
      doc.text(`Bloqué : ${summary.gate.blocked ? "oui" : "non"}`);
      if (summary.gate.reason) {
        doc.text(`Raison : ${summary.gate.reason}`, { width: 495 });
      }
    } else {
      doc.text("Aucun résultat de gate.");
    }
    doc.moveDown(0.6);

    // Scans
    doc.fontSize(13).fillColor("#0f172a").text("Synthèse par scanner");
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor("#475569");
    doc.text("Scanner", 50, doc.y, { width: 150, continued: true });
    doc.text("Statut", 200, doc.y, { width: 80, continued: true });
    doc.text("C / H / M / L / I", 280, doc.y, { width: 150, continued: true });
    doc.text("Durée", 430, doc.y, { width: 80 });
    doc.moveDown(0.2);

    for (const s of summary.scans) {
      if (doc.y > 740) doc.addPage();
      const y = doc.y;
      doc.fontSize(9).fillColor("#0f172a");
      doc.text(s.scanner, 50, y, { width: 145 });
      doc.fillColor(severityColor(s.status === "FAILED" ? "CRITICAL" : "INFO"));
      doc.text(s.status, 200, y, { width: 75 });
      doc.fillColor("#0f172a");
      doc.text(
        `${s.critical} / ${s.high} / ${s.medium} / ${s.low} / ${s.info}`,
        280,
        y,
        { width: 145 },
      );
      doc.text(formatDuration(s.durationMs), 430, y, { width: 80 });
      doc.moveDown(0.35);
    }

    doc.moveDown(0.6);
    doc.fontSize(13).fillColor("#0f172a").text("Totaux");
    doc.fontSize(10).fillColor("#334155");
    doc.text(
      `Critiques : ${summary.totals.critical} · Élevées : ${summary.totals.high} · ` +
        `Moyennes : ${summary.totals.medium} · Faibles : ${summary.totals.low} · ` +
        `Info : ${summary.totals.info}`,
    );
    doc.text(`Vulnérabilités (occurrences du pipeline) : ${summary.vulnerabilityCount}`);
    doc.moveDown(0.6);

    // Top findings
    doc.fontSize(13).fillColor("#0f172a").text("Top findings");
    doc.moveDown(0.3);
    if (summary.topFindings.length === 0) {
      doc.fontSize(10).fillColor("#64748b").text("Aucun finding.");
    } else {
      for (const f of summary.topFindings) {
        if (doc.y > 720) doc.addPage();
        doc.fontSize(9).fillColor(severityColor(f.severity));
        doc.text(`[${f.severity}] ${f.tool}`, { continued: false });
        doc.fillColor("#334155");
        doc.text(
          `${f.packageName ?? "—"} · ${f.filePath ?? "—"}`,
          { width: 495 },
        );
        doc.text(f.description ?? "—", { width: 495 });
        if (f.reference) doc.text(f.reference, { width: 495 });
        doc.moveDown(0.35);
      }
    }

    doc.moveDown(0.6);
    doc.fontSize(13).fillColor("#0f172a").text("Chaîne de livraison");
    doc.fontSize(10).fillColor("#334155");
    doc.text(`Image Docker : ${summary.dockerImage?.imageTag ?? "—"}`);
    doc.text(`Image signée : ${summary.dockerImage?.signed ? "oui" : "non"}`);
    doc.text(
      `SBOM : ${
        summary.sbom
          ? `${summary.sbom.packageCount} paquet(s) (${summary.sbom.format})`
          : "non généré"
      }`,
    );
    doc.text(
      `Déploiement : ${
        summary.deployment
          ? `${summary.deployment.environment ?? ""} ${summary.deployment.status} ${summary.deployment.url ?? ""}`
          : "—"
      }`,
    );

    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}

// ============================================================
// ÉCRITURE
// ============================================================

export async function writeReportFiles(
  summary: ReportSummary,
  pipelineId: string,
): Promise<{ htmlPath: string; pdfPath: string }> {
  const dir = reportsDirectory();
  await fs.mkdir(dir, { recursive: true });

  const htmlPath = path.join(dir, `${pipelineId}.html`);
  const pdfPath = path.join(dir, `${pipelineId}.pdf`);

  await fs.writeFile(htmlPath, generateHtml(summary), "utf8");
  await generatePdf(summary, pdfPath);

  return { htmlPath, pdfPath };
}
