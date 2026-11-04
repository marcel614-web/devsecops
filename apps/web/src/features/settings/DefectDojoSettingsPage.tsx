// apps/web/src/features/settings/DefectDojoSettingsPage.tsx
import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Save,
  Shield,
  TestTube,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { SettingsPageHeader } from "./SettingsPageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/feedback/Toast";
import {
  useDefectDojoConfig,
  useUpdateDefectDojoConfig,
  useTestDefectDojoConfig,
} from "@/hooks/useDefectDojo";
import { getErrorMessage } from "@/services/api";
import { timeAgo } from "@/lib/utils";

export function DefectDojoSettingsPage() {
  const toast = useToast();
  const { data: config, isLoading } = useDefectDojoConfig();
  const updateMutation = useUpdateDefectDojoConfig();
  const testMutation = useTestDefectDojoConfig();

  const [url, setUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (config) setUrl(config.url ?? "");
  }, [config]);

  const handleTest = async () => {
    setTestResult(null);
    setError(null);
    try {
      const result = await testMutation.mutateAsync({
        url: url.trim() || undefined,
        apiToken: apiToken.trim() || undefined,
      });
      setTestResult(result);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleSave = async () => {
    setError(null);
    try {
      await updateMutation.mutateAsync({
        url: url.trim() || undefined,
        apiToken: apiToken.trim() || undefined,
      });
      toast.show("success", "Configuration DefectDojo enregistrée");
      setApiToken("");
      setTestResult(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  if (isLoading) {
    return (
      <div>
        <SettingsPageHeader title="DefectDojo" />
        <div className="h-64 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      </div>
    );
  }

  return (
    <div>
      <SettingsPageHeader
        title="Configuration DefectDojo"
        description="Intégration optionnelle pour l'envoi des résultats normalisés"
      />

      <Card
        className={`mb-6 border-2 ${
          config?.configured
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-amber-500/40 bg-amber-500/5"
        }`}
      >
        <CardContent className="flex items-center gap-4 py-4">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              config?.configured ? "bg-emerald-500/15" : "bg-amber-500/15"
            }`}
          >
            {config?.configured ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : (
              <AlertCircle className="h-5 w-5 text-amber-500" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {config?.configured
                ? "DefectDojo configuré"
                : "DefectDojo non configuré"}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {config?.configured
                ? `${config.url ?? "URL non renseignée"} · Jeton ${
                    config.hasApiToken ? "enregistré" : "absent"
                  } · Mise à jour ${timeAgo(config.updatedAt)}`
                : "Renseignez l'URL et le jeton API ci-dessous pour activer l'export."}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" /> Paramètres
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm mb-1">URL DefectDojo</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://defectdojo.example"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">
              Jeton API
              {config?.hasApiToken && (
                <span className="ml-2 text-emerald-500 text-xs">(déjà enregistré)</span>
              )}
            </label>
            <Input
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="Laisser vide pour conserver l'existant"
            />
          </div>

          {testResult && (
            <div
              className={`text-sm p-3 rounded border ${
                testResult.ok
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600"
                  : "bg-red-500/10 border-red-500/30 text-red-600"
              }`}
            >
              {testResult.ok ? "✓ " : "✗ "}
              {testResult.message}
            </div>
          )}
          {error && (
            <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={!url || testMutation.isPending}
            >
              {testMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <TestTube className="w-4 h-4" />
              )}
              Tester
            </Button>
            <Button onClick={handleSave} loading={updateMutation.isPending}>
              <Save className="w-4 h-4" /> Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}