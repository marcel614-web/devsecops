// apps/web/src/features/servers/ServerTestResultPanel.tsx
import { CheckCircle2, KeyRound, ShieldAlert, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface TestResult {
  ssh: { ok: boolean; error?: string; latencyMs?: number };
  hostKey?: {
    observedFingerprint: string | null;
    trustedFingerprint: string | null;
    matches: boolean;
    trusted: boolean;
  };
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
  onTrustHostKey?: (fingerprint: string) => void;
  trusting?: boolean;
}

export function ServerTestResultPanel({
  result,
  onTrustHostKey,
  trusting,
}: Props) {
  const rows = buildRows(result);
  const hostKey = result.hostKey;

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

        {hostKey && (
          <div className="mt-2 border-t border-border pt-2">
            <div className="flex items-start gap-3 text-sm">
              <div className="shrink-0 mt-0.5">
                {hostKey.trusted ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-amber-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Clé d'hôte SSH</span>
                  <span
                    className={
                      hostKey.trusted
                        ? "text-xs text-emerald-600 dark:text-emerald-400"
                        : "text-xs text-amber-600 dark:text-amber-400"
                    }
                  >
                    {hostKey.trusted
                      ? "référence de confiance vérifiée"
                      : "non enregistrée ou différente"}
                  </span>
                </div>
                {hostKey.observedFingerprint && (
                  <p className="mt-1 break-all font-mono text-[11px] text-muted">
                    observée : {hostKey.observedFingerprint}
                  </p>
                )}
                {hostKey.trustedFingerprint && (
                  <p className="break-all font-mono text-[11px] text-muted">
                    attendue : {hostKey.trustedFingerprint}
                  </p>
                )}
                {!hostKey.observedFingerprint && (
                  <p className="mt-0.5 text-xs text-muted">
                    Aucune empreinte observée : la vérification de la clé
                    d'hôte n'a pas abouti.
                  </p>
                )}
                {hostKey.observedFingerprint && !hostKey.trusted && (
                  <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Vérifiez cette empreinte par un autre canal (console du
                      serveur, administrateur) avant de l'enregistrer. Aucun
                      déploiement n'est possible sans référence de confiance.
                    </p>
                    {onTrustHostKey && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-2 gap-1.5"
                        loading={trusting}
                        onClick={() =>
                          onTrustHostKey(hostKey.observedFingerprint!)
                        }
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        Enregistrer cette empreinte
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
