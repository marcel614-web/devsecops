import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Shield, Server, Cpu, CheckCircle2, AlertTriangle, ScanSearch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/feedback/Toast";
import { projectService } from "@/services/project.service";
import { useServers } from "@/hooks/useServers";
import { getErrorMessage } from "@/services/api";
import { cn } from "@/lib/utils";
import type { ProjectDetail, Technology } from "@/types/api";

const DEFAULT_GATE = { critical: 0, high: 2, medium: 10, low: -1 };

export function ProjectConfigTab({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: servers, isLoading: serversLoading } = useServers({ pageSize: 100 });

  const initialGate = project.config
    ? { critical: project.config.securityGateCritical, high: project.config.securityGateHigh, medium: project.config.securityGateMedium, low: project.config.securityGateLow }
    : DEFAULT_GATE;

  const [gate, setGate] = useState(initialGate);
  const [deploymentEnabled, setDeploymentEnabled] = useState(project.deploymentEnabled);
  const [serverId, setServerId] = useState<string>(project.serverId ?? "");
  const [technology, setTechnology] = useState<Technology>(project.technology ?? "UNKNOWN");

  useEffect(() => {
    if (project.config) {
      setGate({ critical: project.config.securityGateCritical, high: project.config.securityGateHigh, medium: project.config.securityGateMedium, low: project.config.securityGateLow });
    }
    setDeploymentEnabled(project.deploymentEnabled);
    setServerId(project.serverId ?? "");
    setTechnology(project.technology);
  }, [project]);

  const gateDirty = JSON.stringify(gate) !== JSON.stringify(initialGate);
  const deployDirty = deploymentEnabled !== project.deploymentEnabled || serverId !== (project.serverId ?? "");
  const techDirty = technology !== project.technology;

  const done = (msg: string) => () => {
    toast.show("success", msg);
    qc.invalidateQueries({ queryKey: ["project", project.id] });
  };
  const fail = (err: unknown) => toast.show("error", getErrorMessage(err));

  const gateMutation = useMutation({
    mutationFn: () => projectService.updateConfig(project.id, {
      securityGateCritical: gate.critical, securityGateHigh: gate.high, securityGateMedium: gate.medium, securityGateLow: gate.low,
    }),
    onSuccess: done("Seuils du Security Gate enregistrés"), onError: fail,
  });
  const deploymentMutation = useMutation({
    mutationFn: () => projectService.update(project.id, { deploymentEnabled, serverId: serverId || null }),
    onSuccess: done("Déploiement enregistré"), onError: fail,
  });
  const technologyMutation = useMutation({
    mutationFn: () => projectService.update(project.id, { technology }),
    onSuccess: done("Technologie enregistrée"), onError: fail,
  });

  const hasServerLinked = !!project.serverId;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {/* Déploiement */}
      <Card className={cn("xl:col-span-2", !hasServerLinked && "border-amber-500/40")}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Server className="h-4 w-4" /> Déploiement</CardTitle>
            {hasServerLinked ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" /> Configuré</span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-500"><AlertTriangle className="h-3.5 w-3.5" /> Serveur manquant</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasServerLinked && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              Sans serveur associé, l'étape <code>Docker Build</code> échouera et bloquera le pipeline. Sélectionnez un serveur ci-dessous.
            </div>
          )}

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Déploiement automatique</p>
              <p className="text-xs text-muted">Déploie à chaque pipeline réussi qui passe le Security Gate.</p>
            </div>
            <Toggle checked={deploymentEnabled} onChange={setDeploymentEnabled} label="Déploiement automatique" />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Serveur de déploiement</label>
            {serversLoading ? (
              <p className="text-xs text-muted">Chargement des serveurs…</p>
            ) : servers && servers.items.length === 0 ? (
              <p className="text-xs text-muted">
                Aucun serveur disponible. <a href="/servers" className="text-primary-500 hover:underline">Ajouter un serveur</a>
              </p>
            ) : (
              <Select value={serverId} onChange={(e) => setServerId(e.target.value)}>
                <option value="">Aucun serveur</option>
                {servers?.items.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.host}:{s.sshPort}){s.status === "ok" ? " ✓" : ""}</option>
                ))}
              </Select>
            )}
            <p className="mt-1 text-xs text-muted">Docker y construit l'image et l'application y est déployée.</p>
            {deploymentEnabled && !serverId && <p role="alert" className="mt-1 text-xs text-amber-600">Choisissez un serveur pour activer le déploiement.</p>}
          </div>

          <div className="flex justify-end">
            <Button onClick={() => deploymentMutation.mutate()} loading={deploymentMutation.isPending} disabled={!deployDirty || (deploymentEnabled && !serverId)} className="gap-2">
              <Save className="h-4 w-4" /> Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Technologie */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="h-4 w-4" /> Technologie</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Technologie du projet</label>
            <Select value={technology} onChange={(e) => setTechnology(e.target.value as Technology)}>
              <option value="NODEJS">Node.js / JavaScript</option>
              <option value="PHP">PHP</option>
              <option value="PYTHON">Python</option>
              <option value="UNKNOWN">Inconnu (détection manuelle)</option>
            </Select>
            <p className="mt-1 text-xs text-muted">Détermine le Dockerfile par défaut et l'outil SCA utilisé.</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => technologyMutation.mutate()} loading={technologyMutation.isPending} disabled={!techDirty} className="gap-2">
              <Save className="h-4 w-4" /> Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Security Gate */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4 text-primary-500" /> Security Gate</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted">
            Si un compteur dépasse son seuil, le déploiement est bloqué et le pipeline passe en <code className="text-amber-500">SECURITY_BLOCKED</code>.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Critiques max" value={gate.critical} onChange={(v) => setGate((g) => ({ ...g, critical: v }))} min={0} />
            <Field label="Élevées max" value={gate.high} onChange={(v) => setGate((g) => ({ ...g, high: v }))} min={0} />
            <Field label="Moyennes max" value={gate.medium} onChange={(v) => setGate((g) => ({ ...g, medium: v }))} min={0} />
            <Field label="Faibles max" hint="-1 = illimité" value={gate.low} onChange={(v) => setGate((g) => ({ ...g, low: v }))} min={-1} />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => gateMutation.mutate()} loading={gateMutation.isPending} disabled={!gateDirty} className="gap-2">
              <Save className="h-4 w-4" /> Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Scanners */}
      {project.config && (
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><ScanSearch className="h-4 w-4" /> Scanners</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
              <ScannerRow name="Gitleaks" desc="Secrets" enabled={project.config.gitleaksEnabled} />
              <ScannerRow name="Semgrep" desc="SAST" enabled={project.config.semgrepEnabled} />
              <ScannerRow name="SCA" desc="Dépendances" enabled={project.config.scaEnabled} />
              <ScannerRow name="Trivy" desc="Image Docker" enabled={project.config.trivyEnabled} />
              <ScannerRow name="OWASP ZAP" desc="DAST" enabled={project.config.zapEnabled} />
            </ul>
            <p className="mt-3 text-xs text-muted">Lecture seule pour le moment.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary-500", checked ? "bg-primary-600" : "bg-slate-300 dark:bg-slate-600")}
    >
      <span className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked && "translate-x-5")} />
    </button>
  );
}

function Field({ label, hint, value, onChange, min }: { label: string; hint?: string; value: number; onChange: (v: number) => void; min: number }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted">{label}</label>
      <Input type="number" min={min} value={value} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))} />
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function ScannerRow({ name, desc, enabled }: { name: string; desc: string; enabled: boolean }) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
      <div>
        <p className="font-medium">{name}</p>
        <p className="text-xs text-muted">{desc}</p>
      </div>
      <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", enabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-500" : "bg-slate-500/15 text-muted")}>
        {enabled ? "Activé" : "Désactivé"}
      </span>
    </li>
  );
}
