// packages/scanners/src/severity/osv.ts
import type { ScannerSeverity } from "../scanner";

/**
 * Résolution de sévérité via l'API OSV (Open Source Vulnerabilities).
 *
 * PROBLÈME CORRIGÉ : `pip-audit` ne fournit aucune sévérité dans sa sortie
 * JSON. L'ancien code classifying donc TOUTES les vulnérabilités Python en
 * `MEDIUM`, ce qui neutralisait complètement les seuils
 * `securityGateCritical` / `securityGateHigh` pour les projets Python :
 * un CVE critique ne bloquait jamais le pipeline.
 *
 * On interroge donc l'API OSV (une seule requête batch pour toutes les
 * vulnérabilités du scan) et on en déduit la sévérité à partir du score
 * CVSS. En cas d'indisponibilité du réseau, on applique une sévérité
 * CONSERVATRICE (`HIGH`) plutôt que `MEDIUM` : en cas de doute, on ne
 * sous-estime pas la gravité.
 */

const OSV_VULN_URL = "https://api.osv.dev/v1/vulns";

/** Nombre de requêtes OSV lancées en parallèle (l'API est publique). */
const OSV_CONCURRENCY = 5;

/** Sévérité appliquée quand aucune information n'est disponible. */
export const FALLBACK_SEVERITY: ScannerSeverity = "HIGH";

/**
 * Seuils CVSS (base score) → sévérité DevSecOps.
 * Alignés sur les seuils du Security Gate (critical=0, high=2, medium=10).
 */
export function scoreToSeverity(score: number): ScannerSeverity {
  if (!Number.isFinite(score)) return FALLBACK_SEVERITY;
  if (score >= 9.0) return "CRITICAL";
  if (score >= 7.0) return "HIGH";
  if (score >= 4.0) return "MEDIUM";
  if (score > 0) return "LOW";
  return "INFO";
}

/**
 * Calcule le score CVSS de base à partir d'un vecteur.
 * Implémentation simplifiée conforme à la spécification CVSS v3.1.
 */
export function cvssVectorToScore(vector: string): number | null {
  if (!vector || !vector.startsWith("CVSS:")) return null;

  const parts = vector.split("/");
  const metrics = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const [key, value] = part.split(":");
    if (key && value) metrics.set(key, value);
  }

  const av = metrics.get("AV");
  const ac = metrics.get("AC");
  const pr = metrics.get("PR");
  const ui = metrics.get("UI");
  const s = metrics.get("S");
  const c = metrics.get("C");
  const i = metrics.get("I");
  const a = metrics.get("A");

  if (!av || !ac || !pr || !ui || !s || !c || !i || !a) return null;

  const AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
  const AC: Record<string, number> = { L: 0.77, H: 0.44 };
  const UI: Record<string, number> = { N: 0.85, R: 0.62 };
  const CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

  // Le privilège requis dépend du périmètre de l'impact.
  const scopeChanged = s === "C";
  const PR: Record<string, number> = scopeChanged
    ? { N: 0.85, L: 0.68, H: 0.5 }
    : { N: 0.85, L: 0.62, H: 0.27 };

  const avV = AV[av];
  const acV = AC[ac];
  const prV = PR[pr];
  const uiV = UI[ui];
  const cV = CIA[c];
  const iV = CIA[i];
  const aV = CIA[a];

  if (
    avV === undefined ||
    acV === undefined ||
    prV === undefined ||
    uiV === undefined ||
    cV === undefined ||
    iV === undefined ||
    aV === undefined
  ) {
    return null;
  }

  const iss = 1 - (1 - cV) * (1 - iV) * (1 - aV);
  const impact =
    scopeChanged === true
      ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
      : 6.42 * iss;

  if (impact <= 0) return 0;

  const exploitability = 8.22 * avV * acV * prV * uiV;

  const raw =
    scopeChanged === true
      ? Math.min(1.08 * (impact + exploitability), 10)
      : Math.min(impact + exploitability, 10);

  // Arrondi à l'entier inférieur (spécification CVSS v3.1).
  return Math.ceil(raw * 10) / 10;
}

interface OsvSeverityEntry {
  type?: string;
  score?: string;
}

interface OsvVuln {
  id?: string;
  aliases?: string[];
  severity?: OsvSeverityEntry[];
  database_specific?: { severity?: string };
}

/** URL de la fiche OSV d'un identifiant (CVE, GHSA, PYSEC…). */
export function osvVulnUrl(id: string): string {
  return `${OSV_VULN_URL}/${encodeURIComponent(id)}`;
}

/**
 * Extrait la sévérité d'une entrée OSV.
 * Exporte pour être testable unitairement.
 */
export function severityFromOsvVuln(vuln: OsvVuln): ScannerSeverity | null {
  // 1. Score CVSS (vector ou score direct)
  for (const entry of vuln.severity ?? []) {
    const score = entry.score ?? "";
    if (score.startsWith("CVSS:")) {
      const computed = cvssVectorToScore(score);
      if (computed !== null) return scoreToSeverity(computed);
    } else {
      const numeric = Number(score);
      if (Number.isFinite(numeric)) return scoreToSeverity(numeric);
    }
  }

  // 2. Sévérité déclarée par la base (ex. GHSA "HIGH")
  const dbSeverity = vuln.database_specific?.severity;
  if (dbSeverity) {
    const normalized = dbSeverity.toUpperCase();
    if (
      normalized === "CRITICAL" ||
      normalized === "HIGH" ||
      normalized === "MODERATE" ||
      normalized === "MEDIUM" ||
      normalized === "LOW" ||
      normalized === "MODERATE"
    ) {
      if (normalized === "MODERATE") return "MEDIUM";
      return normalized as ScannerSeverity;
    }
  }

  return null;
}

async function fetchOsvVuln(
  id: string,
  signal: AbortSignal,
): Promise<OsvVuln | null> {
  const response = await fetch(osvVulnUrl(id), {
    method: "GET",
    headers: { accept: "application/json" },
    signal,
  });

  // Un identifiant inconnu n'est pas une erreur : on garde le fallback.
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`OSV a répondu ${response.status} pour ${id}`);
  }

  return (await response.json()) as OsvVuln;
}

/**
 * Interroge l'API OSV pour obtenir la sévérité d'un lot d'identifiants
 * (CVE-xxxx, GHSA-xxxx, PYSEC-xxxx...).
 *
 * CORRECTION : l'ancienne implémentation utilisait `/v1/querybatch` en
 * envoyant l'identifiant de vulnérabilité comme **nom de package PyPI**
 * (`package: { name: "CVE-2024-..." }`). L'API ne renvoyait donc jamais la
 * fiche attendue et toutes les vulnérabilités tombaient dans le fallback.
 * On interroge maintenant `/v1/vulns/{id}`.
 *
 * Les échecs individuels sont tolérés : une CVE introuvable ou une erreur
 * réseau ne doit pas annuler la résolution des autres identifiants.
 *
 * @returns Map identifiant → sévérité (seuls les identifiants trouvés sont présents)
 */
export async function fetchOsvSeverities(
  ids: string[],
  timeoutMs = 15_000,
): Promise<Map<string, ScannerSeverity>> {
  const result = new Map<string, ScannerSeverity>();
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return result;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let offset = 0; offset < unique.length; offset += OSV_CONCURRENCY) {
      const chunk = unique.slice(offset, offset + OSV_CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (id) => ({ id, vuln: await fetchOsvVuln(id, controller.signal) })),
      );

      for (const entry of settled) {
        if (entry.status !== "fulfilled" || !entry.value.vuln) continue;

        const { id, vuln } = entry.value;
        const severity = severityFromOsvVuln(vuln);
        if (!severity) continue;

        // On associe la sévérité à l'identifiant demandé ET à ses alias.
        result.set(id, severity);
        for (const alias of vuln.aliases ?? []) {
          result.set(alias, severity);
        }
        if (vuln.id) result.set(vuln.id, severity);
      }
    }

    return result;
  } finally {
    clearTimeout(timer);
  }
}
