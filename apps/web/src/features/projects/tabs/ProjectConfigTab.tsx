// apps/web/src/features/projects/tabs/ProjectConfigTab.tsx
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/feedback/Toast";
import { projectService } from "@/services/project.service";
import { getErrorMessage } from "@/services/api";
import type { ProjectDetail } from "@/types/api";

export function ProjectConfigTab({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [gate, setGate] = useState({
    critical: 0, high: 2, medium: 10, low: -1,
  });

  useEffect(() => {
    if (project.config) {
      setGate({
        critical: project.config.securityGateCritical,
        high: project.config.securityGateHigh,
        medium: project.config.securityGateMedium,
        low: project.config.securityGateLow,
      });
    }
  }, [project.config]);

  const mutation = useMutation({
    mutationFn: () =>
      projectService.updateConfig(project.id, {
        securityGateCritical: gate.critical,
        securityGateHigh: gate.high,
        securityGateMedium: gate.medium,
        securityGateLow: gate.low,
      }),
    onSuccess: () => {
      toast.show("success", "Configuration mise à jour");
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  if (!project.config) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted">Aucune configuration disponible.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-500" />
          <CardTitle>Security Gate — Seuils</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted">
            Si un compteur dépasse son seuil, le déploiement est bloqué et le pipeline est marqué{" "}
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
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            className="w-full"
          >
            <Save className="w-4 h-4" /> Enregistrer
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scanners activés</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <ScannerRow name="Gitleaks (secrets)" enabled={project.config.gitleaksEnabled} />
            <ScannerRow name="Semgrep (SAST)" enabled={project.config.semgrepEnabled} />
            <ScannerRow name="SCA (npm audit)" enabled={project.config.scaEnabled} />
            <ScannerRow name="Trivy (image)" enabled={project.config.trivyEnabled} />
            <ScannerRow name="OWASP ZAP (DAST)" enabled={project.config.zapEnabled} />
          </ul>
          <p className="text-xs text-muted mt-3">
            Ces interrupteurs sont pour l'instant en lecture seule depuis l'interface.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label, value, onChange, min,
}: { label: string; value: number; onChange: (v: number) => void; min: number }) {
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
        className={`text-xs px-2 py-0.5 rounded ${
          enabled
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-500"
            : "bg-slate-500/15 text-muted"
        }`}
      >
        {enabled ? "Activé" : "Désactivé"}
      </span>
    </li>
  );
}