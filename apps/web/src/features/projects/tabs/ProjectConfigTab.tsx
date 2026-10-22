import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FlaskConical,
  Plus,
  Save,
  ScanSearch,
  Server,
  Shield,
  ShieldAlert,
  Trash2,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/feedback/Toast";
import { projectService } from "@/services/project.service";
import type { CreateGateExceptionInput } from "@/services/project.service";
import { useServers } from "@/hooks/useServers";
import { getErrorMessage } from "@/services/api";
import { cn } from "@/lib/utils";
import type {
  ProjectConfiguration,
  ProjectDetail,
  SecurityGateException,
  SecurityGateMode,
  Severity,
  Technology,
} from "@/types/api";

const DEFAULT_GATE = { critical: 0, high: 2, medium: 10, low: -1 };

const DEFAULT_SCANNERS = {
  gitleaks: true,
  semgrep: true,
  sca: true,
  iac: true,
  trivy: true,
  syft: true,
  zap: true,
  cosign: false,
};

type ScannerState = typeof DEFAULT_SCANNERS;

interface Profile {
  id: string;
  name: string;
  description: string;
  scanners: ScannerState;
}

const PROFILES: Profile[] = [
  {
    id: "recommended",
    name: "Recommandé",
    description: "Tous les scanners standards, signature désactivée.",
    scanners: { ...DEFAULT_SCANNERS },
  },
  {
    id: "strict",
    name: "Strict",
    description: "Tous les scanners + signature Cosign obligatoire.",
    scanners: {
      gitleaks: true,
      semgrep: true,
      sca: true,
      iac: true,
      trivy: true,
      syft: true,
      zap: true,
      cosign: true,
    },
  },
  {
    id: "fast",
    name: "Rapide",
    description: "Secrets, dépendances et image uniquement.",
    scanners: {
      gitleaks: true,
      semgrep: false,
      sca: true,
      iac: false,
      trivy: true,
      syft: false,
      zap: false,
      cosign: false,
    },
  },
];

const SCANNER_ROWS: Array<{
  key: keyof ScannerState;
  name: string;
  desc: string;
}> = [
  { key: "gitleaks", name: "Gitleaks", desc: "Secrets dans le code" },
  { key: "semgrep", name: "Semgrep", desc: " analyse statique (SAST)" },
  { key: "sca", name: "SCA", desc: "Dépendances npm / composer / pip" },
  { key: "iac", name: "Trivy config", desc: "IaC : Dockerfile, K8s, Terraform" },
  { key: "trivy", name: "Trivy image", desc: "Vulnérabilités de l'image Docker" },
  { key: "syft", name: "Syft", desc: "SBOM de l'image Docker" },
  { key: "zap", name: "OWASP ZAP", desc: "Analyse dynamique (DAST)" },
  { key: "cosign", name: "Cosign", desc: "Signature de l'image" },
];

function scannersFromConfig(
  config: ProjectConfiguration | null,
): ScannerState {
  if (!config) return { ...DEFAULT_SCANNERS };
  return {
    gitleaks: config.gitleaksEnabled,
    semgrep: config.semgrepEnabled,
    sca: config.scaEnabled,
    iac: config.iacEnabled,
    trivy: config.trivyEnabled,
    syft: config.syftEnabled,
    zap: config.zapEnabled,
    cosign: config.cosignEnabled,
  };
}

function toDateInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ProjectConfigTab({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: servers, isLoading: serversLoading } = useServers({
    pageSize: 100,
  });

  // ----------------------------------------------------------
  // États
  // ----------------------------------------------------------
  const [gate, setGate] = useState(
    project.config
      ? {
          critical: project.config.securityGateCritical,
          high: project.config.securityGateHigh,
          medium: project.config.securityGateMedium,
          low: project.config.securityGateLow,
        }
      : DEFAULT_GATE,
  );
  const [gateMode, setGateMode] = useState<SecurityGateMode>(
    project.config?.gateMode ?? "WARNING",
  );
  const [gateEnforcementAt, setGateEnforcementAt] = useState(
    toDateInput(project.config?.gateEnforcementAt ?? null),
  );
  const [gateCategories, setGateCategories] = useState({
    SECRET: project.config?.gateSecretsEnabled ?? true,
    SAST: project.config?.gateSastEnabled ?? true,
    SCA: project.config?.gateScaEnabled ?? true,
    IAC: project.config?.gateIacEnabled ?? true,
    IMAGE: project.config?.gateImageEnabled ?? true,
    DAST: project.config?.gateDastEnabled ?? true,
  });
  const [scanners, setScanners] = useState<ScannerState>(
    scannersFromConfig(project.config),
  );
  const [deploymentEnabled, setDeploymentEnabled] = useState(
    project.deploymentEnabled,
  );
  const [serverId, setServerId] = useState<string>(project.serverId ?? "");
  const [technology, setTechnology] = useState<Technology>(
    project.technology ?? "UNKNOWN",
  );
  const [strategy, setStrategy] = useState<
    "direct" | "staging_then_production"
  >(project.config?.deploymentStrategy ?? "direct");
  const [stagingPort, setStagingPort] = useState<number | "">(
    project.config?.stagingPort ?? "",
  );
  const [productionPort, setProductionPort] = useState<number | "">(
    project.config?.productionPort ?? "",
  );
  const [autoRollback, setAutoRollback] = useState(
    project.config?.autoRollback ?? true,
  );

  const [exceptionForm, setExceptionForm] = useState<CreateGateExceptionInput>({
    category: "ALL",
    severity: null,
    fingerprint: "",
    reason: "",
    expiresAt: null,
  });

  // ----------------------------------------------------------
  // Synchronisation
  // ----------------------------------------------------------
  useEffect(() => {
    const c = project.config;
    if (c) {
      setGate({
        critical: c.securityGateCritical,
        high: c.securityGateHigh,
        medium: c.securityGateMedium,
        low: c.securityGateLow,
      });
      setGateMode(c.gateMode);
      setGateEnforcementAt(toDateInput(c.gateEnforcementAt));
      setGateCategories({
        SECRET: c.gateSecretsEnabled,
        SAST: c.gateSastEnabled,
        SCA: c.gateScaEnabled,
        IAC: c.gateIacEnabled,
        IMAGE: c.gateImageEnabled,
        DAST: c.gateDastEnabled,
      });
      setScanners(scannersFromConfig(c));
      setStrategy(c.deploymentStrategy);
      setStagingPort(c.stagingPort ?? "");
      setProductionPort(c.productionPort ?? "");
      setAutoRollback(c.autoRollback);
    }
    setDeploymentEnabled(project.deploymentEnabled);
    setServerId(project.serverId ?? "");
    setTechnology(project.technology);
  }, [project]);

  // ----------------------------------------------------------
  // Queries
  // ----------------------------------------------------------
  const {
    data: exceptions,
    isLoading: exceptionsLoading,
  } = useQuery({
    queryKey: ["gate-exceptions", project.id],
    queryFn: () => projectService.listGateExceptions(project.id),
  });

  // ----------------------------------------------------------
  // Dirty checks
  // ----------------------------------------------------------
  const initialGate = project.config
    ? {
        critical: project.config.securityGateCritical,
        high: project.config.securityGateHigh,
        medium: project.config.securityGateMedium,
        low: project.config.securityGateLow,
      }
    : DEFAULT_GATE;

  const gateDirty =
    JSON.stringify(gate) !== JSON.stringify(initialGate) ||
    gateMode !== (project.config?.gateMode ?? "WARNING") ||
    gateEnforcementAt !==
      toDateInput(project.config?.gateEnforcementAt ?? null) ||
    JSON.stringify(gateCategories) !==
      JSON.stringify({
        SECRET: project.config?.gateSecretsEnabled ?? true,
        SAST: project.config?.gateSastEnabled ?? true,
        SCA: project.config?.gateScaEnabled ?? true,
        IAC: project.config?.gateIacEnabled ?? true,
        IMAGE: project.config?.gateImageEnabled ?? true,
        DAST: project.config?.gateDastEnabled ?? true,
      });

  const scannersDirty =
    JSON.stringify(scanners) !==
    JSON.stringify(scannersFromConfig(project.config));

  const deployDirty =
    deploymentEnabled !== project.deploymentEnabled ||
    serverId !== (project.serverId ?? "") ||
    strategy !== (project.config?.deploymentStrategy ?? "direct") ||
    stagingPort !== (project.config?.stagingPort ?? "") ||
    productionPort !== (project.config?.productionPort ?? "") ||
    autoRollback !== (project.config?.autoRollback ?? true);

  const techDirty = technology !== project.technology;

  // ----------------------------------------------------------
  // Mutations
  // ----------------------------------------------------------
  const done = (msg: string) => () => {
    toast.show("success", msg);
    qc.invalidateQueries({ queryKey: ["project", project.id] });
  };
  const fail = (err: unknown) => toast.show("error", getErrorMessage(err));

  const gateMutation = useMutation({
    mutationFn: () =>
      projectService.updateConfig(project.id, {
        securityGateCritical: gate.critical,
        securityGateHigh: gate.high,
        securityGateMedium: gate.medium,
        securityGateLow: gate.low,
        gateMode,
        gateEnforcementAt: gateEnforcementAt
          ? new Date(gateEnforcementAt).toISOString()
          : null,
        gateSecretsEnabled: gateCategories.SECRET,
        gateSastEnabled: gateCategories.SAST,
        gateScaEnabled: gateCategories.SCA,
        gateIacEnabled: gateCategories.IAC,
        gateImageEnabled: gateCategories.IMAGE,
        gateDastEnabled: gateCategories.DAST,
      }),
    onSuccess: done("Security Gate enregistré"),
    onError: fail,
  });

  const scannersMutation = useMutation({
    mutationFn: () =>
      projectService.updateConfig(project.id, {
        gitleaksEnabled: scanners.gitleaks,
        semgrepEnabled: scanners.semgrep,
        scaEnabled: scanners.sca,
        iacEnabled: scanners.iac,
        trivyEnabled: scanners.trivy,
        syftEnabled: scanners.syft,
        zapEnabled: scanners.zap,
        cosignEnabled: scanners.cosign,
      }),
    onSuccess: done("Scanners enregistrés"),
    onError: fail,
  });

  const deploymentMutation = useMutation({
    mutationFn: async () => {
      await projectService.update(project.id, {
        deploymentEnabled,
        serverId: serverId || null,
      });
      await projectService.updateConfig(project.id, {
        deploymentStrategy: strategy,
        stagingPort: stagingPort === "" ? null : stagingPort,
        productionPort: productionPort === "" ? null : productionPort,
        autoRollback,
      });
    },
    onSuccess: done("Déploiement enregistré"),
    onError: fail,
  });

  const technologyMutation = useMutation({
    mutationFn: () => projectService.update(project.id, { technology }),
    onSuccess: done("Technologie enregistrée"),
    onError: fail,
  });

  const createExceptionMutation = useMutation({
    mutationFn: () =>
      projectService.createGateException(project.id, {
        ...exceptionForm,
        expiresAt: exceptionForm.expiresAt
          ? new Date(exceptionForm.expiresAt).toISOString()
          : null,
      }),
    onSuccess: () => {
      toast.show("success", "Exception créée");
      setExceptionForm({
        category: "ALL",
        severity: null,
        fingerprint: "",
        reason: "",
        expiresAt: null,
      });
      qc.invalidateQueries({ queryKey: ["gate-exceptions", project.id] });
    },
    onError: fail,
  });

  const deleteExceptionMutation = useMutation({
    mutationFn: (exceptionId: string) =>
      projectService.deleteGateException(project.id, exceptionId),
    onSuccess: () => {
      toast.show("success", "Exception supprimée");
      qc.invalidateQueries({ queryKey: ["gate-exceptions", project.id] });
    },
    onError: fail,
  });

  const hasServerLinked = !!project.serverId;
  const activeProfile = useMemo(
    () =>
      PROFILES.find(
        (p) => JSON.stringify(p.scanners) === JSON.stringify(scanners),
      )?.id ?? null,
    [scanners],
  );

  return (
    <div className="space-y-4">
      {/* Déploiement */}
      <Card
        className={cn(
          "border-border",
          !hasServerLinked && "border-amber-500/40",
        )}
      >
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4" /> Déploiement
            </CardTitle>
            {hasServerLinked ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-500">
                <CheckCircle2 className="h-3.5 w-3.5" /> Configuré
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" /> Serveur manquant
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasServerLinked && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              Sans serveur associé, l'étape <code>Docker Build</code> échouera
              et bloquera le pipeline. Sélectionnez un serveur ci-dessous.
            </div>
          )}

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Déploiement automatique</p>
              <p className="text-xs text-muted">
                Déploie à chaque pipeline réussi qui passe le Security Gate.
              </p>
            </div>
            <Toggle
              checked={deploymentEnabled}
              onChange={setDeploymentEnabled}
              label="Déploiement automatique"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Serveur de déploiement
              </label>
              {serversLoading ? (
                <p className="text-xs text-muted">Chargement des serveurs…</p>
              ) : servers && servers.items.length === 0 ? (
                <p className="text-xs text-muted">
                  Aucun serveur disponible.{" "}
                  <a
                    href="/servers"
                    className="text-primary-500 hover:underline"
                  >
                    Ajouter un serveur
                  </a>
                </p>
              ) : (
                <Select
                  value={serverId}
                  onChange={(e) => setServerId(e.target.value)}
                >
                  <option value="">Aucun serveur</option>
                  {servers?.items.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.host}:{s.sshPort})
                      {s.status === "ok" ? " ✓" : ""}
                    </option>
                  ))}
                </Select>
              )}
              <p className="mt-1 text-xs text-muted">
                Docker y construit l'image et l'application y est déployée.
              </p>
              {deploymentEnabled && !serverId && (
                <p role="alert" className="mt-1 text-xs text-amber-600">
                  Choisissez un serveur pour activer le déploiement.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Stratégie de livraison
              </label>
              <Select
                value={strategy}
                onChange={(e) =>
                  setStrategy(
                    e.target.value as "direct" | "staging_then_production",
                  )
                }
              >
                <option value="direct">Directe en production</option>
                <option value="staging_then_production">
                  Staging puis production
                </option>
              </Select>
              <p className="mt-1 text-xs text-muted">
                Le mode staging exécute ZAP avant la promotion et permet un
                rollback automatique.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 md:grid-cols-3">
            <PortField
              label="Port de production"
              value={productionPort}
              onChange={setProductionPort}
              hint="Vide = allocation automatique"
            />
            {strategy === "staging_then_production" ? (
              <>
                <PortField
                  label="Port de staging"
                  value={stagingPort}
                  onChange={setStagingPort}
                  hint="Vide = allocation automatique"
                />
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={autoRollback}
                      onChange={(e) => setAutoRollback(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    Rollback automatique
                  </label>
                </div>
              </>
            ) : (
              <p className="self-end text-xs text-muted md:col-span-2">
                Un port de staging sera attribué automatiquement si vous activez
                le mode staging.
              </p>
            )}
          </div>
          <p className="text-xs text-muted">
            Les ports sont uniques par serveur. Si un port est déjà utilisé par
            un autre projet, un port libre lui sera attribué au déploiement.
          </p>

          <div className="flex justify-end">
            <Button
              onClick={() => deploymentMutation.mutate()}
              loading={deploymentMutation.isPending}
              disabled={!deployDirty || (deploymentEnabled && !serverId)}
              className="gap-2"
            >
              <Save className="h-4 w-4" /> Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Technologie */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-4 w-4" /> Technologie
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Technologie du projet
              </label>
              <Select
                value={technology}
                onChange={(e) => setTechnology(e.target.value as Technology)}
              >
                <option value="NODEJS">Node.js / JavaScript</option>
                <option value="PHP">PHP</option>
                <option value="PYTHON">Python</option>
                <option value="UNKNOWN">Inconnu (détection manuelle)</option>
              </Select>
              <p className="mt-1 text-xs text-muted">
                Détermine le Dockerfile par défaut et l'outil SCA utilisé
                (npm audit, composer audit, pip-audit).
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => technologyMutation.mutate()}
                loading={technologyMutation.isPending}
                disabled={!techDirty}
                className="gap-2"
              >
                <Save className="h-4 w-4" /> Enregistrer
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Security Gate */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary-500" /> Security Gate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Mode</label>
                <Select
                  value={gateMode}
                  onChange={(e) =>
                    setGateMode(e.target.value as SecurityGateMode)
                  }
                >
                  <option value="WARNING">
                    Avertissement (le déploiement continue)
                  </option>
                  <option value="ENFORCEMENT">
                    Enforcement (blocage du déploiement)
                  </option>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Bascule automatique en enforcement
                </label>
                <Input
                  type="datetime-local"
                  value={gateEnforcementAt}
                  onChange={(e) => setGateEnforcementAt(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-muted">
                  Laisser vide pour conserver le mode choisi.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Critiques max"
                value={gate.critical}
                onChange={(v) => setGate((g) => ({ ...g, critical: v }))}
                min={0}
              />
              <Field
                label="Élevées max"
                value={gate.high}
                onChange={(v) => setGate((g) => ({ ...g, high: v }))}
                min={0}
              />
              <Field
                label="Moyennes max"
                value={gate.medium}
                onChange={(v) => setGate((g) => ({ ...g, medium: v }))}
                min={0}
              />
              <Field
                label="Faibles max"
                hint="-1 = illimité"
                value={gate.low}
                onChange={(v) => setGate((g) => ({ ...g, low: v }))}
                min={-1}
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted">
                Catégories évaluées par le gate
              </p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {(
                  [
                    ["SECRET", "Secrets"],
                    ["SAST", "SAST"],
                    ["SCA", "SCA"],
                    ["IAC", "IaC"],
                    ["IMAGE", "Image"],
                    ["DAST", "DAST"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={gateCategories[key]}
                      onChange={(e) =>
                        setGateCategories((c) => ({
                          ...c,
                          [key]: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-border"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted">
              Un scanner en échec technique est traité comme un problème, jamais
              comme « 0 vulnérabilité ». En mode avertissement, le pipeline
              continue mais le rapport reste en WARNING.
            </p>

            <div className="flex justify-end">
              <Button
                onClick={() => gateMutation.mutate()}
                loading={gateMutation.isPending}
                disabled={!gateDirty}
                className="gap-2"
              >
                <Save className="h-4 w-4" /> Enregistrer
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Scanners */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4" /> Scanners
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PROFILES.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => setScanners({ ...profile.scanners })}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                  activeProfile === profile.id
                    ? "border-primary-500 bg-primary-500/10"
                    : "border-border hover:bg-slate-50 dark:hover:bg-slate-800/40",
                )}
                title={profile.description}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <FlaskConical className="h-3.5 w-3.5" />
                  {profile.name}
                </span>
                <span className="mt-0.5 block text-muted">
                  {profile.description}
                </span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            {SCANNER_ROWS.map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium">{row.name}</p>
                  <p className="text-xs text-muted">{row.desc}</p>
                </div>
                <Toggle
                  checked={scanners[row.key]}
                  onChange={(v) =>
                    setScanners((s) => ({ ...s, [row.key]: v }))
                  }
                  label={row.name}
                />
              </div>
            ))}
          </div>

          <p className="text-xs text-muted">
            L'activation est réelle : chaque scanner ajoute une étape au
            pipeline. Un scanner activé mais indisponible est signalé comme
            échec technique dans le Security Gate.
          </p>

          <div className="flex justify-end">
            <Button
              onClick={() => scannersMutation.mutate()}
              loading={scannersMutation.isPending}
              disabled={!scannersDirty}
              className="gap-2"
            >
              <Save className="h-4 w-4" /> Enregistrer les scanners
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Exceptions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Exceptions datées
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted">
            Une exception cible un finding précis (CVE, GHSA, règle ou
            empreinte). Elle ne masque plus tout un bucket catégorie/sévérité.
            Elle est auditée, datée et doit être justifiée. Les findings marqués
            faux positif ou risque accepté sont également exclus.
          </p>

          {exceptionsLoading ? (
            <p className="text-xs text-muted">Chargement…</p>
          ) : exceptions && exceptions.length > 0 ? (
            <ul className="space-y-2">
              {exceptions.map((exception) => (
                <li
                  key={exception.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{exception.category}</span>
                      {exception.severity
                        ? ` · ${exception.severity}`
                        : " · toutes sévérités"}
                      {exception.fingerprint && (
                        <span className="ml-2 font-mono text-xs text-muted">
                          {exception.fingerprint}
                        </span>
                      )}
                      {exception.expiresAt && (
                        <span className="ml-2 text-xs text-muted">
                          expire le{" "}
                          {new Date(exception.expiresAt).toLocaleString("fr-FR")}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted">{exception.reason}</p>
                    {exception.createdBy && (
                      <p className="text-[11px] text-muted">
                        par {exception.createdBy.name}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      deleteExceptionMutation.mutate(exception.id)
                    }
                    loading={deleteExceptionMutation.isPending}
                    aria-label="Supprimer l'exception"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">Aucune exception active.</p>
          )}

          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-muted">Catégorie</label>
              <Select
                value={exceptionForm.category}
                onChange={(e) =>
                  setExceptionForm((f) => ({
                    ...f,
                    category: e.target
                      .value as CreateGateExceptionInput["category"],
                  }))
                }
              >
                <option value="ALL">Toutes</option>
                <option value="SECRET">Secrets</option>
                <option value="SAST">SAST</option>
                <option value="SCA">SCA</option>
                <option value="IMAGE">Image</option>
                <option value="IAC">IaC</option>
                <option value="DAST">DAST</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Sévérité</label>
              <Select
                value={exceptionForm.severity ?? ""}
                onChange={(e) =>
                  setExceptionForm((f) => ({
                    ...f,
                    severity: (e.target.value || null) as Severity | null,
                  }))
                }
              >
                <option value="">Toutes</option>
                <option value="CRITICAL">Critique</option>
                <option value="HIGH">Élevée</option>
                <option value="MEDIUM">Moyenne</option>
                <option value="LOW">Faible</option>
                <option value="INFO">Info</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">
                Expiration
              </label>
              <Input
                type="datetime-local"
                value={toDateInput(exceptionForm.expiresAt ?? null)}
                onChange={(e) =>
                  setExceptionForm((f) => ({
                    ...f,
                    expiresAt: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  }))
                }
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => createExceptionMutation.mutate()}
                loading={createExceptionMutation.isPending}
                disabled={
                  !exceptionForm.reason.trim() ||
                  !exceptionForm.fingerprint.trim()
                }
                className="gap-2"
              >
                <Plus className="h-4 w-4" /> Ajouter
              </Button>
            </div>
            <div className="md:col-span-4">
              <label className="mb-1 block text-xs text-muted">
                Finding ciblé (CVE, GHSA, règle, empreinte)
              </label>
              <Input
                value={exceptionForm.fingerprint}
                onChange={(e) =>
                  setExceptionForm((f) => ({
                    ...f,
                    fingerprint: e.target.value,
                  }))
                }
                maxLength={300}
                placeholder="Ex. : CVE-2024-1234 ou GHSA-xxxx-yyyy-zzzz"
              />
            </div>
            <div className="md:col-span-4">
              <label className="mb-1 block text-xs text-muted">
                Justification
              </label>
              <textarea
                value={exceptionForm.reason}
                onChange={(e) =>
                  setExceptionForm((f) => ({
                    ...f,
                    reason: e.target.value,
                  }))
                }
                rows={2}
                maxLength={1000}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                placeholder="Ex. : CVE sans correctif, risque accepté par l'équipe sécurité jusqu'à la prochaine release."
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary-500",
        checked ? "bg-primary-600" : "bg-slate-300 dark:bg-slate-600",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

function PortField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number | "";
  onChange: (v: number | "") => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted">{label}</label>
      <Input
        type="number"
        min={1}
        max={65535}
        placeholder="Auto"
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange("");
            return;
          }
          const parsed = Number(raw);
          onChange(
            Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535
              ? parsed
              : "",
          );
        }}
      />
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  min,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted">{label}</label>
      <Input
        type="number"
        min={min}
        value={value}
        onChange={(e) =>
          onChange(Math.max(min, Number(e.target.value) || 0))
        }
      />
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
