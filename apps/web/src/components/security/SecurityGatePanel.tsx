// apps/web/src/components/security/SecurityGatePanel.tsx
import { AlertTriangle, ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { SecurityGateResult } from "@/types/api";

export function SecurityGatePanel({ gate }: { gate: SecurityGateResult | null }) {
  if (!gate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Security Gate</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">
            Le Security Gate ne s'est pas encore exécuté.
          </p>
        </CardContent>
      </Card>
    );
  }

  const config =
    gate.status === "PASSED"
      ? {
          Icon: ShieldCheck,
          label: "PASSED",
          tone: "border-emerald-500/40 bg-emerald-500/5",
          iconColor: "text-emerald-500",
          desc: "Aucun seuil dépassé",
        }
      : gate.status === "WARNING"
        ? {
            Icon: AlertTriangle,
            label: "WARNING",
            tone: "border-amber-500/40 bg-amber-500/5",
            iconColor: "text-amber-500",
            desc: "Avertissement — déploiement autorisé tant qu'aucun contrôle obligatoire n'a échoué",
          }
        : gate.status === "BLOCKED"
          ? {
              Icon: ShieldAlert,
              label: "BLOCKED",
              tone: "border-red-500/40 bg-red-500/5",
              iconColor: "text-red-500",
              desc: "Déploiement bloqué",
            }
          : {
              Icon: Shield,
              label: gate.status,
              tone: "border-border bg-surface",
              iconColor: "text-muted",
              desc: "",
            };

  const thresholds = [
    {
      label: "Critiques",
      count: gate.critical,
      max: gate.rulesJson?.critical ?? 0,
    },
    {
      label: "Élevées",
      count: gate.high,
      max: gate.rulesJson?.high ?? 0,
    },
    {
      label: "Moyennes",
      count: gate.medium,
      max: gate.rulesJson?.medium ?? 0,
    },
    {
      label: "Faibles",
      count: gate.low,
      max: gate.rulesJson?.low ?? -1,
    },
  ];

  const technicalFailures = gate.technicalFailures ?? [];
  const exceptions = Array.isArray(gate.exceptionsApplied)
    ? gate.exceptionsApplied
    : gate.exceptionsApplied?.applied ?? [];
  const controls = gate.rulesJson?.controls ?? [];
  const policyVersion = gate.rulesJson?.policyVersion;
  const rawCounts = gate.rulesJson?.rawCounts;

  const controlLabels: Record<string, string> = {
    SUCCESS_NO_FINDINGS: "Aucun finding",
    SUCCESS_WITH_FINDINGS: "Findings détectés",
    INTERRUPTED: "Interrompu",
    TIMED_OUT: "Délai dépassé",
    SCANNER_UNAVAILABLE: "Scanner indisponible",
    PARSE_ERROR: "Rapport illisible",
    NOT_APPLICABLE: "Non applicable",
    DISABLED: "Désactivé",
    REQUIRED_NOT_RUN: "Obligatoire non exécuté",
  };

  return (
    <Card className={cn("border-2", config.tone)}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>
            Security Gate
            {policyVersion !== undefined && (
              <span className="ml-2 text-xs font-normal text-muted">
                politique v{policyVersion}
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {gate.mode === "ENFORCEMENT" ? "Enforcement" : "Avertissement"}
            </span>
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <config.Icon className={cn("w-4 h-4", config.iconColor)} />
              {config.label}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted">{config.desc}</p>

        <div className="grid grid-cols-2 gap-2">
          {thresholds.map((t) => {
            const exceeded = t.max >= 0 && t.count > t.max;
            return (
              <div
                key={t.label}
                className={cn(
                  "p-2 rounded border",
                  exceeded
                    ? "border-red-500/40 bg-red-500/5"
                    : "border-border bg-surface",
                )}
              >
                <p className="text-xs text-muted">{t.label}</p>
                <p className="text-sm font-semibold">
                  {t.count}
                  <span className="text-muted font-normal">
                    {" "}
                    / {t.max < 0 ? "∞" : t.max}
                  </span>
                </p>
              </div>
            );
          })}
        </div>

        {controls.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">
              État des contrôles
            </p>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {controls.map((control) => {
                const failed = [
                  "INTERRUPTED",
                  "TIMED_OUT",
                  "SCANNER_UNAVAILABLE",
                  "PARSE_ERROR",
                  "REQUIRED_NOT_RUN",
                ].includes(control.state);
                return (
                  <li
                    key={control.category}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px]",
                      failed
                        ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400"
                        : "border-border bg-surface text-muted",
                    )}
                  >
                    <span className="font-medium">
                      {control.category}
                      {control.mandatory ? " · obligatoire" : ""}
                    </span>
                    <span title={control.reason ?? undefined}>
                      {controlLabels[control.state] ?? control.state}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {technicalFailures.length > 0 && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <strong className="mb-0.5 block">
              Échecs techniques ({technicalFailures.length})
            </strong>
            <ul className="space-y-0.5">
              {technicalFailures.map((f, i) => (
                <li key={`${f.step}-${i}`}>
                  {f.category}
                  {f.mandatory ? " (obligatoire)" : ""} · {f.step} : {f.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {exceptions.length > 0 && (
          <div className="rounded border border-sky-500/30 bg-sky-500/10 p-2 text-xs text-sky-700 dark:text-sky-400">
            <strong className="mb-0.5 block">
              Exceptions appliquées ({exceptions.length})
            </strong>
            <ul className="space-y-0.5">
              {exceptions.map((e) => (
                <li key={e.id}>
                  {e.category}
                  {e.severity ? ` · ${e.severity}` : " · toutes sévérités"} —{" "}
                  {e.reason}
                  {e.expiresAt
                    ? ` (expire ${new Date(e.expiresAt).toLocaleDateString("fr-FR")})`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {rawCounts &&
          Object.values(rawCounts).some(
            (value) => typeof value === "number" && value > 0,
          ) &&
          Object.keys(rawCounts).some(
            (key) =>
              typeof rawCounts[key] === "number" &&
              rawCounts[key] !==
                (gate as unknown as Record<string, number>)[key],
          ) && (
            <p className="text-[11px] text-muted">
              Comptage brut avant exclusions (exceptions / faux positifs) :{" "}
              {Object.entries(rawCounts)
                .filter(([, value]) => typeof value === "number")
                .map(([key, value]) => `${key} ${value}`)
                .join(" · ")}
            </p>
          )}

        {gate.reason && (
          <div
            className={cn(
              "rounded border p-2 text-xs",
              gate.blocked
                ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
            )}
          >
            <strong className="mb-0.5 block">
              {gate.blocked ? "Motif du blocage" : "Détail de l'évaluation"}
            </strong>
            {gate.reason}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
