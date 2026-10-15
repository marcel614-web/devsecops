// apps/web/src/features/servers/ServerTestResultPanel.tsx
import { CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";

interface TestResult {
  ssh: { ok: boolean; error?: string; latencyMs?: number };
  docker: { ok: boolean; version?: string; error?: string };
  dockerCompose: { ok: boolean; version?: string; error?: string };
  nginx: { ok: boolean; version?: string; error?: string };
}

interface Row {
  label: string;
  ok: boolean;
  detail?: string;
  error?: string;
}

function buildRows(result: TestResult): Row[] {
  return [
    {
      label: "Connexion SSH",
      ok: result.ssh.ok,
      detail:
        result.ssh.latencyMs !== undefined
          ? `${result.ssh.latencyMs} ms`
          : undefined,
      error: result.ssh.error,
    },
    {
      label: "Docker",
      ok: result.docker.ok,
      detail: result.docker.version,
      error: result.docker.error,
    },
    {
      label: "Docker Compose",
      ok: result.dockerCompose.ok,
      detail: result.dockerCompose.version,
      error: result.dockerCompose.error,
    },
    {
      label: "Nginx",
      ok: result.nginx.ok,
      detail: result.nginx.version,
      error: result.nginx.error,
    },
  ];
}

interface Props {
  result: TestResult;
}

export function ServerTestResultPanel({ result }: Props) {
  const rows = buildRows(result);

  return (
    <Card className="mt-3">
      <CardContent className="py-3 space-y-2">
        <p className="text-xs font-medium text-muted uppercase tracking-wide">
          Résultat du test
        </p>
        {rows.map((row) => (
          <div key={row.label} className="flex items-start gap-3 text-sm">
            <div className="shrink-0 mt-0.5">
              {row.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{row.label}</span>
                {row.ok && row.detail && (
                  <span className="text-xs text-muted font-mono">
                    {row.detail}
                  </span>
                )}
              </div>
              {!row.ok && row.error && (
                <p className="text-xs text-red-500 mt-0.5">{row.error}</p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}