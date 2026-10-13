// apps/web/src/components/security/ScanSummary.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatDuration } from "@/lib/utils";
import type { SecurityScan } from "@/types/api";

export function ScanSummary({ scans }: { scans: SecurityScan[] }) {
  if (scans.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Analyses de sécurité</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">Aucun scanner n'a été exécuté.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analyses de sécurité ({scans.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/60">
          {scans.map((s) => {
            const total =
              s.criticalCount +
              s.highCount +
              s.mediumCount +
              s.lowCount +
              s.infoCount;
            return (
              <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.scanner}</p>
                  <p className="text-xs text-muted">
                    {s.type} · {formatDuration(s.durationMs)}
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs shrink-0">
                  {s.criticalCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-red-700 text-white font-bold">
                      C {s.criticalCount}
                    </span>
                  )}
                  {s.highCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-orange-600 text-white font-bold">
                      H {s.highCount}
                    </span>
                  )}
                  {s.mediumCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500 text-black font-bold">
                      M {s.mediumCount}
                    </span>
                  )}
                  {s.lowCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-yellow-300 text-black font-bold">
                      L {s.lowCount}
                    </span>
                  )}
                  {total === 0 && (
                    <span className="text-emerald-500 text-xs">
                      0 résultat
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}