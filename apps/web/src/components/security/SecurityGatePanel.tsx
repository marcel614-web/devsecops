// apps/web/src/components/security/SecurityGatePanel.tsx
import { ShieldCheck, ShieldAlert, Shield } from "lucide-react";
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

  return (
    <Card className={cn("border-2", config.tone)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Security Gate</CardTitle>
          <span className="flex items-center gap-1.5 text-sm font-bold">
            <config.Icon className={cn("w-4 h-4", config.iconColor)} />
            {config.label}
          </span>
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

        {gate.reason && (
          <div className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">
            <strong className="block mb-0.5">Motif du blocage</strong>
            {gate.reason}
          </div>
        )}
      </CardContent>
    </Card>
  );
}