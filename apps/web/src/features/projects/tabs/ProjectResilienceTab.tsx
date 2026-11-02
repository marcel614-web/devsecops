// apps/web/src/features/projects/tabs/ProjectResilienceTab.tsx
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  Clock,
  Play,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SimpleBadge, SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/feedback/Toast";
import { projectService } from "@/services/project.service";
import { rescanService } from "@/services/rescan.service";
import { verificationService } from "@/services/verification.service";
import { getErrorMessage } from "@/services/api";
import { formatDate } from "@/lib/utils";
import type {
  DeploymentCheck,
  ProjectDetail,
  RescanDetail,
  RescanRun,
} from "@/types/api";

const DEFAULT_INTERVAL = 24;
const DEFAULT_TIMEOUT = 20;
const DEFAULT_MAX_RUNS = 1;

function shortDigest(digest: string | null | undefined): string {
  if (!digest) return "—";
  return digest.length > 22 ? `${digest.slice(0, 19)}…` : digest;
}

function statusTone(status: string): string {
  if (status === "PASSED" || status === "SUCCESS") {
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  }
  if (status === "FAILED" || status === "TIMED_OUT") {
    return "bg-red-500/15 text-red-600 dark:text-red-400";
  }
  if (status === "SKIPPED" || status === "CANCELLED") {
    return "bg-slate-500/15 text-slate-600 dark:text-slate-400";
  }
  return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-primary-600" : "bg-slate-300 dark:bg-slate-600"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function RunDetail({
  project,
  run,
  remediationEnabled,
  onRemediate,
  remediating,
}: {
  project: ProjectDetail;
  run: RescanDetail;
  remediationEnabled: boolean;
  onRemediate: () => void;
  remediating: boolean;
}) {
  const comparison = run.comparisonJson;
  const summary = run.summaryJson;
  const active = run.status === "QUEUED" || run.status === "RUNNING";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={run.status} />
          <SimpleBadge>{run.trigger === "MANUAL" ? "Manuel" : "Planifié"}</SimpleBadge>
          <span className="text-xs text-muted">
            {formatDate(run.startedAt ?? run.createdAt)}
          </span>
        </div>
        {remediationEnabled &&
          run.status === "SUCCESS" &&
          summary?.riskFound && (
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              loading={remediating}
              onClick={onRemediate}
            >
              <Wrench className="h-3.5 w-3.5" /> Lancer une remédiation
            </Button>
          )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Artefact</p>
          <p className="mt-1 font-mono text-xs">{shortDigest(run.imageDigest)}</p>
          <p className="text-xs text-muted">{run.imageTag ?? "tag inconnu"}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Nouveaux</p>
          <p className="text-xl font-semibold">{comparison?.counts.new ?? 0}</p>
          <p className="text-xs text-muted">
            dont {comparison?.counts.newBySeverity.CRITICAL ?? 0} critique(s)
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Sévérités aggravées</p>
          <p className="text-xl font-semibold">
            {comparison?.counts.severityIncreased ?? 0}
          </p>
          <p className="text-xs text-muted">
            {comparison?.counts.increasedToHighOrCritical ?? 0} vers high/critical
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Résolus</p>
          <p className="text-xl font-semibold">
            {comparison?.counts.resolved ?? 0}
          </p>
          <p className="text-xs text-muted">
            baseline {comparison?.baselineFingerprints ?? 0} finding(s)
          </p>
        </div>
      </div>

      {run.error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          {run.error}
        </div>
      )}

      {comparison && !comparison.baselineAvailable && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          Aucune baseline exploitable (scan image du pipeline ou rescan
          précédent). Le rescan est conservé, mais aucun finding n'est qualifié
          de « nouveau » pour éviter une alerte trompeuse.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-medium">
            Nouveaux résultats ({comparison?.newFindings.length ?? 0})
          </h4>
          <div className="space-y-2">
            {comparison?.newFindings.length ? (
              comparison.newFindings.slice(0, 25).map((finding) => (
                <div
                  key={finding.fingerprint}
                  className="rounded-md border border-border p-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <span className="font-medium">
                      {finding.packageName ?? finding.tool}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-muted">
                    {finding.description ?? finding.reference ?? "Sans description"}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted">Aucun nouveau résultat.</p>
            )}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium">
            Changements de sévérité ({comparison?.severityChanges.length ?? 0})
          </h4>
          <div className="space-y-2">
            {comparison?.severityChanges.length ? (
              comparison.severityChanges.slice(0, 25).map((change) => (
                <div
                  key={`${change.fingerprint}:${change.currentSeverity}`}
                  className="rounded-md border border-border p-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={change.previousSeverity} />
                    <span>→</span>
                    <SeverityBadge severity={change.currentSeverity} />
                    <span className="font-medium">
                      {change.packageName ?? change.tool}
                    </span>
                  </div>
                  <p className="mt-1 text-muted">{change.reference ?? "—"}</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted">
                Aucun changement de sévérité.
              </p>
            )}
          </div>
        </div>
      </div>

      {comparison?.resolvedFindings.length ? (
        <div>
          <h4 className="mb-2 text-sm font-medium">
            Résultats résolus ({comparison.resolvedFindings.length})
          </h4>
          <div className="space-y-1">
            {comparison.resolvedFindings.slice(0, 20).map((finding) => (
              <div
                key={finding.fingerprint}
                className="flex items-center gap-2 text-xs text-muted"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <SeverityBadge severity={finding.severity} />
                <span>{finding.packageName ?? finding.tool}</span>
                <span>{finding.reference ?? ""}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-border p-3 text-xs text-muted">
        <p>
          Contrôles : {run.controls.join(", ")} — timeout{" "}
          {Math.round(run.timeoutMs / 1000)}s — durée{" "}
          {run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : "—"}
        </p>
        <p className="mt-1">
          Scanner : {summary?.scanner ?? "trivy"}{" "}
          {summary?.scannerVersion ? `(${summary.scannerVersion})` : ""}
        </p>
        <p className="mt-1">
          Pipeline d'origine :{" "}
          {run.pipeline ? `${run.pipeline.commitSha.slice(0, 8)} (${run.pipeline.branch})` : "—"}
        </p>
        <p className="mt-1">
          Baseline : {summary?.baseline?.source ?? "aucune"} —{" "}
          {summary?.baseline?.available ? "disponible" : "indisponible"}
        </p>
      </div>

      {active && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Résultat en cours de
          production — aucun redéploiement ne sera déclenché.
        </p>
      )}

      {project.config && !remediationEnabled && summary?.riskFound && (
        <p className="rounded-md border border-border p-2 text-xs text-muted">
          La politique de remédiation est désactivée. Aucun pipeline de
          correction ne peut être lancé depuis ce rescan.
        </p>
      )}
    </div>
  );
}

function VerificationCard({
  checks,
  status,
  environment,
  commitSha,
  createdAt,
  error,
}: {
  checks: DeploymentCheck[];
  status: string;
  environment: string;
  commitSha: string;
  createdAt: string;
  error: string | null;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <SimpleBadge className={statusTone(status)}>{status}</SimpleBadge>
          <SimpleBadge>{environment}</SimpleBadge>
          <span className="font-mono">{commitSha.slice(0, 8)}</span>
          <span className="text-muted">{formatDate(createdAt)}</span>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-2 grid grid-cols-1 gap-1 md:grid-cols-2">
        {checks.map((check) => (
          <div
            key={check.key}
            className="flex items-start gap-2 rounded border border-border/60 px-2 py-1.5 text-xs"
          >
            {check.status === "PASSED" ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            ) : check.status === "SKIPPED" ? (
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            ) : (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
            )}
            <div>
              <p className="font-medium">{check.label}</p>
              <p className="text-muted">{check.detail}</p>
              {(check.expected || check.observed) && (
                <p className="font-mono text-[11px] text-muted">
                  attendu: {check.expected ?? "—"} / observé: {check.observed ?? "—"}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProjectResilienceTab({ project }: { project: ProjectDetail }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const config = project.config;

  const [enabled, setEnabled] = useState(config?.rescanEnabled ?? false);
  const [intervalHours, setIntervalHours] = useState(
    config?.rescanIntervalHours ?? DEFAULT_INTERVAL,
  );
  const [maxRunsPerDay, setMaxRunsPerDay] = useState(
    config?.rescanMaxRunsPerDay ?? DEFAULT_MAX_RUNS,
  );
  const [timeoutMinutes, setTimeoutMinutes] = useState(
    Math.round((config?.rescanTimeoutMs ?? DEFAULT_TIMEOUT * 60_000) / 60_000),
  );
  const [remediationEnabled, setRemediationEnabled] = useState(
    config?.rescanRemediationEnabled ?? false,
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("rescan"),
  );

  useEffect(() => {
    setEnabled(config?.rescanEnabled ?? false);
    setIntervalHours(config?.rescanIntervalHours ?? DEFAULT_INTERVAL);
    setMaxRunsPerDay(config?.rescanMaxRunsPerDay ?? DEFAULT_MAX_RUNS);
    setTimeoutMinutes(
      Math.round(
        (config?.rescanTimeoutMs ?? DEFAULT_TIMEOUT * 60_000) / 60_000,
      ),
    );
    setRemediationEnabled(config?.rescanRemediationEnabled ?? false);
  }, [config]);

  useEffect(() => {
    const fromUrl = searchParams.get("rescan");
    if (fromUrl) setSelectedId(fromUrl);
  }, [searchParams]);

  const listQuery = useQuery({
    queryKey: ["rescans", project.id],
    queryFn: () => rescanService.list(project.id, { pageSize: 20 }),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!selectedId && listQuery.data?.items[0]) {
      setSelectedId(listQuery.data.items[0].id);
    }
  }, [listQuery.data, selectedId]);

  const detailQuery = useQuery({
    queryKey: ["rescan", project.id, selectedId],
    queryFn: () => rescanService.get(project.id, selectedId!),
    enabled: !!selectedId,
    refetchInterval: 10_000,
  });

  const verificationsQuery = useQuery({
    queryKey: ["deployment-verifications", project.id],
    queryFn: () => verificationService.list(project.id, { pageSize: 10 }),
  });

  const configDirty =
    enabled !== (config?.rescanEnabled ?? false) ||
    intervalHours !== (config?.rescanIntervalHours ?? DEFAULT_INTERVAL) ||
    maxRunsPerDay !== (config?.rescanMaxRunsPerDay ?? DEFAULT_MAX_RUNS) ||
    timeoutMinutes !==
      Math.round((config?.rescanTimeoutMs ?? DEFAULT_TIMEOUT * 60_000) / 60_000) ||
    remediationEnabled !== (config?.rescanRemediationEnabled ?? false);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["rescans", project.id] });
    void qc.invalidateQueries({ queryKey: ["rescan", project.id] });
    void qc.invalidateQueries({ queryKey: ["project", project.id] });
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      projectService.updateConfig(project.id, {
        rescanEnabled: enabled,
        rescanIntervalHours: intervalHours,
        rescanMaxRunsPerDay: maxRunsPerDay,
        rescanTimeoutMs: timeoutMinutes * 60_000,
        rescanRemediationEnabled: remediationEnabled,
        rescanControls: ["IMAGE"],
      }),
    onSuccess: () => {
      toast.show("success", "Politique de rescan enregistrée");
      invalidate();
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const triggerMutation = useMutation({
    mutationFn: () => rescanService.trigger(project.id),
    onSuccess: (run) => {
      toast.show("success", "Rescan planifié");
      setSelectedId(run.id);
      invalidate();
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: () => rescanService.cancel(project.id, selectedId!),
    onSuccess: () => {
      toast.show("success", "Rescan annulé");
      invalidate();
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const remediationMutation = useMutation({
    mutationFn: () =>
      rescanService.remediate(
        project.id,
        selectedId!,
        "Remédiation confirmée explicitement depuis l'historique de rescan",
      ),
    onSuccess: (pipeline) => {
      toast.show(
        "success",
        `Pipeline de remédiation ${pipeline.id.slice(0, 8)} lancé`,
      );
      invalidate();
      void qc.invalidateQueries({ queryKey: ["project-pipelines", project.id] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const supportsRemediation = config?.rescanRemediationEnabled ?? false;
  const selected = detailQuery.data as RescanDetail | undefined;
  const active =
    selected?.status === "QUEUED" || selected?.status === "RUNNING";

  const history = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Rescan périodique
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Réévaluation des artefacts livrés</p>
              <p className="text-xs text-muted">
                Utilise la queue BullMQ existante, vérifie le digest sur la VM et
                ne redéploie jamais. Le contrôle supporté est le scan image Trivy
                sur l'artefact exact déjà déployé.
              </p>
            </div>
            <Toggle
              checked={enabled}
              onChange={setEnabled}
              label="Rescan périodique"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium">
                Fréquence (heures)
              </label>
              <Input
                type="number"
                min={1}
                max={720}
                value={intervalHours}
                disabled={!enabled}
                onChange={(e) =>
                  setIntervalHours(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium">
                Rescans maximum / 24 h
              </label>
              <Input
                type="number"
                min={1}
                max={24}
                value={maxRunsPerDay}
                disabled={!enabled}
                onChange={(e) =>
                  setMaxRunsPerDay(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium">
                Timeout (minutes)
              </label>
              <Input
                type="number"
                min={1}
                max={60}
                value={timeoutMinutes}
                disabled={!enabled}
                onChange={(e) =>
                  setTimeoutMinutes(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Autoriser la remédiation</p>
              <p className="text-xs text-muted">
                Un pipeline peut être créé sur un nouveau commit, uniquement par
                action explicite. Aucun déploiement automatique n'est déclenché
                par le rescan.
              </p>
            </div>
            <Toggle
              checked={remediationEnabled}
              onChange={setRemediationEnabled}
              label="Autoriser la remédiation"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Prochaine échéance : {formatDate(config?.rescanNextRunAt)} —
              dernier rescan : {formatDate(config?.rescanLastRunAt)}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => triggerMutation.mutate()}
                loading={triggerMutation.isPending}
                disabled={!enabled || !!active}
              >
                <Play className="h-4 w-4" /> Rescan maintenant
              </Button>
              <Button
                className="gap-2"
                onClick={() => saveMutation.mutate()}
                loading={saveMutation.isPending}
                disabled={!configDirty}
              >
                <Save className="h-4 w-4" /> Enregistrer
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" /> Historique des rescans
            </CardTitle>
          </CardHeader>
          <CardContent>
            {listQuery.isLoading ? (
              <p className="text-sm text-muted">Chargement…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted">
                Aucun rescan. Activez la politique puis lancez une réévaluation
                manuelle.
              </p>
            ) : (
              <div className="space-y-2">
                {history.map((run: RescanRun) => {
                  const risk = run.summaryJson?.riskFound;
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelectedId(run.id)}
                      className={`w-full rounded-lg border p-2 text-left transition-colors ${
                        selectedId === run.id
                          ? "border-primary-500 bg-primary-500/5"
                          : "border-border hover:bg-slate-500/5"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge status={run.status} />
                        <span className="text-xs text-muted">
                          {formatDate(run.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-xs">
                        {run.commitSha.slice(0, 8)} · {shortDigest(run.imageDigest)}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        nouveaux {run.comparisonJson?.counts.new ?? 0} ·
                        aggravés {run.comparisonJson?.counts.severityIncreased ?? 0} ·
                        résolus {run.comparisonJson?.counts.resolved ?? 0}
                        {risk ? " · risque détecté" : ""}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" /> Rapport d'évolution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedId ? (
              <p className="text-sm text-muted">
                Sélectionnez un rescan dans l'historique.
              </p>
            ) : detailQuery.isLoading ? (
              <p className="text-sm text-muted">Chargement du rapport…</p>
            ) : detailQuery.isError ? (
              <p className="text-sm text-red-600">
                {getErrorMessage(detailQuery.error)}
              </p>
            ) : selected ? (
              <>
                {active && (
                  <div className="mb-3 flex justify-end">
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => cancelMutation.mutate()}
                      loading={cancelMutation.isPending}
                    >
                      Annuler le rescan
                    </Button>
                  </div>
                )}
                <RunDetail
                  project={project}
                  run={selected}
                  remediationEnabled={supportsRemediation}
                  remediating={remediationMutation.isPending}
                  onRemediate={() => {
                    if (
                      window.confirm(
                        "Créer un pipeline de correction sur le HEAD courant ? " +
                          "Aucun déploiement n'est déclenché par le rescan lui-même.",
                      )
                    ) {
                      remediationMutation.mutate();
                    }
                  }}
                />
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Conformité post-déploiement
          </CardTitle>
        </CardHeader>
        <CardContent>
          {verificationsQuery.isLoading ? (
            <p className="text-sm text-muted">Chargement…</p>
          ) : !verificationsQuery.data?.items.length ? (
            <p className="text-sm text-muted">
              Aucune vérification enregistrée. Elle est exécutée automatiquement
              après un déploiement réussi si les contrôles sont activés.
            </p>
          ) : (
            <div className="space-y-3">
              {verificationsQuery.data.items.map((verification) => (
                <VerificationCard
                  key={verification.id}
                  checks={
                    Array.isArray(verification.checksJson)
                      ? verification.checksJson
                      : []
                  }
                  status={verification.status}
                  environment={verification.environment}
                  commitSha={verification.pipeline?.commitSha ?? "inconnu"}
                  createdAt={verification.createdAt}
                  error={verification.error}
                />
              ))}
            </div>
          )}
          <p className="mt-3 flex items-center gap-2 text-xs text-muted">
            <Server className="h-3.5 w-3.5" /> Ces constats proviennent de la VM
            autorisée du déploiement (conteneur, endpoint, port, digest), pas
            d'un scan IaC.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
