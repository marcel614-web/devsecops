// apps/web/src/features/settings/GithubSettingsPage.tsx
import { useState, useEffect } from "react";
import {
  Github,
  CheckCircle2,
  AlertCircle,
  Save,
  TestTube,
  Loader2,
  Eye,
  EyeOff,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { SettingsPageHeader } from "./SettingsPageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/feedback/Toast";
import {
  useGithubConfig,
  useTestGithubConfig,
  useUpdateGithubConfig,
} from "@/hooks/useSystemConfig";
import { getErrorMessage } from "@/services/api";
import { timeAgo } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";

export function GithubSettingsPage() {
  const toast = useToast();
  const { data: config, isLoading } = useGithubConfig();
  const updateMutation = useUpdateGithubConfig();
  const testMutation = useTestGithubConfig();

  const [appId, setAppId] = useState("");
  const [slug, setSlug] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (config) {
      setAppId(config.appId ?? "");
      setSlug(config.slug ?? "");
      setClientId(config.clientId ?? "");
    }
  }, [config]);

  const handleTest = async () => {
    setTestResult(null);
    setError(null);
    try {
      const result = await testMutation.mutateAsync({
        appId: appId.trim(),
        privateKey: privateKey.trim(),
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
        appId: appId.trim() || undefined,
        slug: slug.trim() || undefined,
        privateKey: privateKey.trim() || undefined,
        webhookSecret: webhookSecret.trim() || undefined,
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
      });
      toast.show("success", "Configuration GitHub App enregistrée");
      setPrivateKey("");
      setWebhookSecret("");
      setClientSecret("");
      setTestResult(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  if (isLoading) {
    return (
      <div>
        <SettingsPageHeader title="Configuration GitHub App" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div>
      <SettingsPageHeader
        title="Configuration GitHub App"
        description="Paramètres de l'intégration GitHub App de la plateforme"
      />

      {/* Statut actuel */}
      <Card
        className={`mb-6 border-2 ${
          config?.configured
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-amber-500/40 bg-amber-500/5"
        }`}
      >
        <CardContent className="flex items-center gap-4 py-4">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
              config?.configured ? "bg-emerald-500/15" : "bg-amber-500/15"
            }`}
          >
            {config?.configured ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {config?.configured
                ? "GitHub App configurée"
                : "GitHub App non configurée"}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {config?.configured
                ? `App ID ${config.appId} · Slug ${config.slug} · Mise à jour ${
                    config.updatedAt ? timeAgo(config.updatedAt) : "—"
                  }`
                : "Renseigne les informations de ta GitHub App ci-dessous pour activer l'intégration."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Note explicative */}
      <Card className="mb-6 border-blue-500/40 bg-blue-500/5">
        <CardContent className="flex items-start gap-3 py-4">
          <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0">
            <Info className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-xs text-muted leading-relaxed">
            <p>
              <strong className="text-slate-700 dark:text-slate-200">
                Déclenchement automatique disponible.
              </strong>{" "}
              Les pipelines peuvent être lancés manuellement, ou
              automatiquement sur <code>git push</code> et sur les pull
              requests.
            </p>
            <p className="mt-1">
              Dans les paramètres de la GitHub App, abonnez-la aux événements{" "}
              <code>push</code> et <code>pull_request</code>. Le{" "}
              <strong>webhook secret</strong> est requis pour les
              déclenchements automatiques.
            </p>
            <p className="mt-1">
              Les PR ne sont analysées que si elles ciblent la branche
              surveillée du projet. Un check run est publié sur le commit de
              tête à la fin du pipeline.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Formulaire */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="w-4 h-4" />
            Identifiants GitHub App
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">App ID *</label>
              <Input
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="5316057"
              />
              <p className="text-xs text-muted mt-1">
                Visible en haut de la page de ta GitHub App
              </p>
            </div>
            <div>
              <label className="block text-sm mb-1">Slug *</label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="teste-connection-github"
              />
              <p className="text-xs text-muted mt-1">
                Segment de l'URL{" "}
                <code>github.com/apps/&lt;slug&gt;</code> — en minuscules
                uniquement
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">
              Clé privée (PEM) *
              {config?.hasPrivateKey && (
                <span className="ml-2 text-xs text-emerald-500">
                  (déjà enregistrée — laisser vide pour ne pas changer)
                </span>
              )}
            </label>
            <textarea
              rows={8}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
              className="w-full px-3 py-2 rounded-md bg-slate-900 border border-border text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-xs"
            />
            <p className="text-xs text-muted mt-1">
              Générée sur la page de la GitHub App → « Generate a private key »
            </p>
          </div>

          <div>
            <label className="block text-sm mb-1">
              Webhook secret{" "}
              <span className="text-xs text-muted font-normal">
                (optionnel — déclenchements automatiques uniquement)
              </span>
              {config?.hasWebhookSecret && (
                <span className="ml-2 text-xs text-emerald-500">
                  (déjà enregistré)
                </span>
              )}
            </label>
            <Input
              type={showSecrets ? "text" : "password"}
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="Laisser vide si vous utilisez uniquement le déclenchement manuel"
            />
            <p className="text-xs text-muted mt-1">
              Uniquement si vous voulez que les <code>git push</code>{" "}
              déclenchent des pipelines.
            </p>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-muted hover:text-slate-700 dark:hover:text-slate-200">
              Configuration OAuth optionnelle (user-to-server)
            </summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 pl-4 border-l-2 border-border">
              <div>
                <label className="block text-xs mb-1">Client ID</label>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Iv23li..."
                />
              </div>
              <div>
                <label className="block text-xs mb-1">
                  Client Secret
                  {config?.hasClientSecret && (
                    <span className="ml-2 text-emerald-500">
                      (déjà enregistré)
                    </span>
                  )}
                </label>
                <Input
                  type={showSecrets ? "text" : "password"}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
              </div>
            </div>
          </details>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSecrets((v) => !v)}
              className="text-xs text-muted hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1"
            >
              {showSecrets ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              {showSecrets ? "Masquer" : "Afficher"} les secrets saisis
            </button>
          </div>

          {testResult && (
            <div
              className={`text-sm p-3 rounded border ${
                testResult.ok
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                  : "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400"
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
              disabled={!appId || !privateKey || testMutation.isPending}
            >
              {testMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <TestTube className="w-4 h-4" />
              )}
              Tester la connexion
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