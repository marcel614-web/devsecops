import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/feedback/Toast";

type NotifPrefs = {
  pipelineFailed: boolean;
  securityBlocked: boolean;
  deploymentSuccess: boolean;
};

const KEY = "notif-prefs";
const DEFAULT: NotifPrefs = { pipelineFailed: true, securityBlocked: true, deploymentSuccess: false };

function load(): NotifPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function NotificationsPage() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<NotifPrefs>(load());

  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(prefs));
    toast.show("success", "Préférences enregistrées");
  };

  return (
    <div>
      <PageHeader title="Préférences de notifications" description="Configurer les alertes" />
      <Card>
        <CardContent className="space-y-4 py-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={prefs.pipelineFailed}
              onChange={(e) => setPrefs((p) => ({ ...p, pipelineFailed: e.target.checked }))}
            />
            <span>Notifier en cas d'échec de pipeline</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={prefs.securityBlocked}
              onChange={(e) => setPrefs((p) => ({ ...p, securityBlocked: e.target.checked }))}
            />
            <span>Notifier en cas de Security Gate bloqué</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={prefs.deploymentSuccess}
              onChange={(e) => setPrefs((p) => ({ ...p, deploymentSuccess: e.target.checked }))}
            />
            <span>Notifier en cas de déploiement réussi</span>
          </label>
          <Button onClick={save}>Enregistrer</Button>
          <p className="text-xs text-muted">
            Ces préférences sont enregistrées localement. La boîte de
            notifications reste accessible depuis le menu latéral.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}