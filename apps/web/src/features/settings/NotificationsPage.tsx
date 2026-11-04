import { useState } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  BellOff,
  CheckCheck,
  GitBranch,
  Mail,
  Rocket,
  ShieldAlert,
  ShieldX,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/feedback/Toast";
import { SettingsPageHeader } from "./SettingsPageHeader";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

type NotifPrefs = {
  pipelineFailed: boolean;
  pipelineSuccess: boolean;
  securityBlocked: boolean;
  vulnerabilityCritical: boolean;
  deploymentSuccess: boolean;
  invitationReceived: boolean;
};

const KEY = "notif-prefs";

const DEFAULT: NotifPrefs = {
  pipelineFailed: true,
  pipelineSuccess: false,
  securityBlocked: true,
  vulnerabilityCritical: true,
  deploymentSuccess: false,
  invitationReceived: true,
};

const OPTIONS: Array<{
  key: keyof NotifPrefs;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: string;
}> = [
  {
    key: "pipelineFailed",
    title: "Échec de pipeline",
    description: "Recevoir une alerte lorsqu'un pipeline se termine en échec.",
    icon: GitBranch,
    accent: "bg-red-500/15 text-red-600 dark:text-red-300",
  },
  {
    key: "pipelineSuccess",
    title: "Succès de pipeline",
    description: "Être notifié lorsqu'un pipeline se termine avec succès.",
    icon: CheckCheck,
    accent: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  },
  {
    key: "securityBlocked",
    title: "Security Gate bloqué",
    description:
      "Alerte lorsqu'un pipeline est bloqué par la politique de sécurité.",
    icon: ShieldX,
    accent: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  },
  {
    key: "vulnerabilityCritical",
    title: "Vulnérabilité critique",
    description:
      "Alerte lorsqu'une vulnérabilité critique ou haute est détectée.",
    icon: ShieldAlert,
    accent: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  },
  {
    key: "deploymentSuccess",
    title: "Déploiement réussi",
    description: "Être notifié après un déploiement en production.",
    icon: Rocket,
    accent: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  },
  {
    key: "invitationReceived",
    title: "Invitation à un projet",
    description: "Recevoir une alerte lorsqu'une invitation vous est adressée.",
    icon: Mail,
    accent: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  },
];

function load(): NotifPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT, ...(JSON.parse(raw) as Partial<NotifPrefs>) } : DEFAULT;
  } catch {
    return DEFAULT;
  }
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
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        checked ? "bg-primary-600" : "bg-slate-300 dark:bg-slate-600",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

export function NotificationsPage() {
  const toast = useToast();
  const { data: unreadData } = useUnreadNotificationCount();
  const unreadCount = unreadData?.count ?? 0;
  const [prefs, setPrefs] = useState<NotifPrefs>(load);
  const [savedPrefs, setSavedPrefs] = useState<NotifPrefs>(load);

  const dirty = JSON.stringify(prefs) !== JSON.stringify(savedPrefs);
  const enabledCount = Object.values(prefs).filter(Boolean).length;

  const update = (key: keyof NotifPrefs, value: boolean) => {
    setPrefs((current) => ({ ...current, [key]: value }));
  };

  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(prefs));
    setSavedPrefs(prefs);
    toast.show("success", "Préférences de notifications enregistrées");
  };

  const reset = () => {
    setPrefs(DEFAULT);
    localStorage.setItem(KEY, JSON.stringify(DEFAULT));
    setSavedPrefs(DEFAULT);
    toast.show("info", "Préférences réinitialisées");
  };

  const setAll = (value: boolean) => {
    const next = Object.fromEntries(
      (Object.keys(DEFAULT) as Array<keyof NotifPrefs>).map((key) => [key, value]),
    ) as NotifPrefs;
    setPrefs(next);
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Préférences de notifications"
        description="Personnalisez les alertes que vous souhaitez voir mises en avant"
        actions={
          <Link
            to="/notifications"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <Bell className="h-4 w-4" />
            Boîte de réception
            {unreadCount > 0 && (
              <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600/15 text-primary-600 dark:text-primary-500">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-muted">Alertes activées</p>
              <p className="text-lg font-semibold">
                {enabledCount}
                <span className="text-sm font-normal text-muted">
                  {" "}
                  / {OPTIONS.length}
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/15 text-red-600 dark:text-red-300">
              <Bell className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-muted">Non lues</p>
              <p className="text-lg font-semibold">{unreadCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-500/15 text-slate-600 dark:text-slate-300">
              <BellOff className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-muted">Stockage</p>
              <p className="text-sm font-semibold">Préférences locales</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Types d'alertes</CardTitle>
            <p className="mt-1 text-xs text-muted">
              Ces préférences s'appliquent à votre navigateur.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setAll(true)}>
              Tout activer
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAll(false)}>
              Tout désactiver
            </Button>
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            const checked = prefs[option.key];
            return (
              <div
                key={option.key}
                className="flex items-start gap-4 px-5 py-4"
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                    option.accent,
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{option.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {option.description}
                  </p>
                </div>
                <Toggle
                  checked={checked}
                  onChange={(value) => update(option.key, value)}
                  label={option.title}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">
          Ces préférences sont enregistrées localement dans votre navigateur et
          ne modifient pas les notifications déjà reçues.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset}>
            Réinitialiser
          </Button>
          <Button onClick={save} disabled={!dirty}>
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}
