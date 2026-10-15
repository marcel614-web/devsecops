// apps/web/src/features/projects/tabs/ProjectConfigTab.tsx
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Shield, Server, Cpu, CheckCircle2 } from "lucide-react";
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

export function ProjectConfigTab({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: servers, isLoading: serversLoading } = useServers({
    pageSize: 100,
  });

  // ---- Security Gate ----
  const [gate, setGate] = useState({
    critical: 0,
    high: 2,
    medium: 10,
    low: -1,
  });

  // ---- Déploiement ----
  const [deploymentEnabled, setDeploymentEnabled] = useState(
    project.deploymentEnabled,
  );
  const [serverId, setServerId] = useState<string>(project.serverId ?? "");

  // ---- Technologie ----
  const [technology, setTechnology] = useState<Technology>(
    project.technology ?? "UNKNOWN",
  );

  // Synchronise quand le projet est rechargé
  useEffect(() => {
    if (project.config) {
      setGate({
        critical: project.config.securityGateCritical,
        high: project.config.securityGateHigh,
        medium: project.config.securityGateMedium,
        low: project.config.securityGateLow,
      });
    }
    setDeploymentEnabled(project.deploymentEnabled);
    setServerId(project.serverId ?? "");
    setTechnology(project.technology);
  }, [project]);

  // ---- Mutations ----
  const gateMutation = useMutation({
    mutationFn: () =>
      projectService.updateConfig(project.id, {
        securityGateCritical: gate.critical,
        securityGateHigh: gate.high,
        securityGateMedium: gate.medium,
        securityGateLow: gate.low,
      }),
    onSuccess: () => {
      toast.show("success", "Seuils du Security Gate mis à jour");
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const deploymentMutation = useMutation({
    mutationFn: () =>
      projectService.update(project.id, {
        deploymentEnabled,
        serverId: serverId || null,
      }),
    onSuccess: () => {
      toast.show("success", "Configuration de déploiement mise à jour");
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const technologyMutation = useMutation({
    mutationFn: () =>
      projectService.update(project.id, { technology }),
    onSuccess: () => {
      toast.show("success", "Technologie mise à jour");
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const hasServerLinked = !!project.serverId;

  return (
    <div className="space-y-4">
      {/* ============================================
          SECTION DÉPLOIEMENT
      ============================================ */}
      <Card
        className={cn(
          "border-2",
          hasServerLinked
            ? "border-emerald-500/40"
            : "border-amber-500/40 bg-amber-500/5",
        )}
      >
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Server className="w-4 h-4" />
              Déploiement
            </CardTitle>
            {hasServerLinked ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-500 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Configuré
              </span>
            ) : (
              <span className="text-xs text-amber-600 dark:text-amber-500 font-medium">
                ⚠ Non configuré
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasServerLinked && (
            <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-2.5">
              <strong className="block mb-1">Configuration requise</strong>
              Sans serveur associé, l'étape <code>Docker Build</code> échouera
              et bloquera le pipeline. Sélectionne un serveur ci-dessous.
            </div>
          )}

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={deploymentEnabled}
                onChange={(e) => setDeploymentEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary-500 focus:ring-primary-500"
              />
              <span>Activer le déploiement automatique</span>
            </label>
          </div>

          <div>
            <label className="block text-sm mb-1">
              Serveur de déploiement
            </label>
            {serversLoading ? (
              <p className="text-xs text-muted">Chargement des serveurs…</p>
            ) : servers && servers.items.length === 0 ? (
              <div className="text-xs text-muted">
                Aucun serveur disponible.{" "}
                <a
                  href="/servers"
                  className="text-primary-500 hover:underline"
                >
                  Créer un serveur →
                </a>
              </div>
            ) : (
              <Select
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
              >
                <option value="">— Aucun serveur —</option>
                {servers?.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.host}:{s.sshPort})
                    {s.status === "ok" ? " ✓" : ""}
                  </option>
                ))}
              </Select>
            )}
            <p className="text-xs text-muted mt-1">
              Le serveur sur lequel l'application sera déployée et où Docker
              construira l'image.
            </p>
          </div>

          <Button
            onClick={() => deploymentMutation.mutate()}
            loading={deploymentMutation.isPending}
            disabled={!serverId && deploymentEnabled}
            className="w-full"
          >
            <Save className="w-4 h-4" /> Enregistrer le déploiement
          </Button>
        </CardContent>
      </Card>

      {/* ============================================
          SECTION TECHNOLOGIE
      ============================================ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            Technologie
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm mb-1">
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
            <p className="text-xs text-muted mt-1">
              Détermine le Dockerfile par défaut et l'outil SCA utilisé.
            </p>
          </div>

          <Button
            onClick={() => technologyMutation.mutate()}
            loading={technologyMutation.isPending}
            className="w-full"
          >
            <Save className="w-4 h-4" /> Enregistrer la technologie
          </Button>
        </CardContent>
      </Card>

      {/* ============================================
          SECTION SECURITY GATE
      ============================================ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary-500" />
            Security Gate — Seuils
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted">
            Si un compteur dépasse son seuil, le déploiement est bloqué et le
            pipeline est marqué{" "}
            <code className="text-amber-500">SECURITY_BLOCKED</code>.
          </p>

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
              label="Faibles max (-1 = illimité)"
              value={gate.low}
              onChange={(v) => setGate((g) => ({ ...g, low: v }))}
              min={-1}
            />
          </div>

          <Button
            onClick={() => gateMutation.mutate()}
            loading={gateMutation.isPending}
            className="w-full"
          >
            <Save className="w-4 h-4" /> Enregistrer les seuils
          </Button>
        </CardContent>
      </Card>

      {/* ============================================
          SECTION SCANNERS
      ============================================ */}
      {project.config && (
        <Card>
          <CardHeader>
            <CardTitle>Scanners activés</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <ScannerRow
                name="Gitleaks (secrets)"
                enabled={project.config.gitleaksEnabled}
              />
              <ScannerRow
                name="Semgrep (SAST)"
                enabled={project.config.semgrepEnabled}
              />
              <ScannerRow
                name="SCA (npm audit)"
                enabled={project.config.scaEnabled}
              />
              <ScannerRow
                name="Trivy (image)"
                enabled={project.config.trivyEnabled}
              />
              <ScannerRow
                name="OWASP ZAP (DAST)"
                enabled={project.config.zapEnabled}
              />
            </ul>
            <p className="text-xs text-muted mt-3">
              Ces interrupteurs sont pour l'instant en lecture seule depuis
              l'interface.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// SOUS-COMPOSANTS
// ============================================================

function Field({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
}) {
  return (
    <div>
      <label className="block text-xs mb-1 text-muted">{label}</label>
      <Input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function ScannerRow({ name, enabled }: { name: string; enabled: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span>{name}</span>
      <span
        className={cn(
          "text-xs px-2 py-0.5 rounded",
          enabled
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-500"
            : "bg-slate-500/15 text-muted",
        )}
      >
        {enabled ? "Activé" : "Désactivé"}
      </span>
    </li>
  );
}