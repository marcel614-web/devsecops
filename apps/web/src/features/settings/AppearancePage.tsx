import { Check, Moon, Sun } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { SettingsPageHeader } from "./SettingsPageHeader";
import { useThemeStore } from "@/stores/themeStore";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

function ThemePreview({ theme }: { theme: Theme }) {
  const light = theme === "light";
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        light
          ? "border-slate-200 bg-slate-50"
          : "border-slate-700 bg-slate-900",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-red-400" />
        <span className="h-2 w-2 rounded-full bg-amber-400" />
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span
          className={cn(
            "ml-auto h-2 w-10 rounded-full",
            light ? "bg-slate-300" : "bg-slate-700",
          )}
        />
      </div>
      <div className="mt-3 flex gap-2">
        <div
          className={cn(
            "h-16 w-8 rounded",
            light ? "bg-slate-200" : "bg-slate-800",
          )}
        />
        <div className="flex-1 space-y-1.5">
          <div
            className={cn(
              "h-2 w-3/4 rounded",
              light ? "bg-slate-300" : "bg-slate-700",
            )}
          />
          <div
            className={cn(
              "h-2 w-1/2 rounded",
              light ? "bg-slate-200" : "bg-slate-800",
            )}
          />
          <div
            className={cn(
              "mt-3 h-8 rounded border",
              light
                ? "border-slate-200 bg-white"
                : "border-slate-700 bg-slate-800",
            )}
          />
        </div>
      </div>
    </div>
  );
}

export function AppearancePage() {
  const { theme, set } = useThemeStore();

  const options: Array<{
    value: Theme;
    title: string;
    description: string;
    icon: typeof Sun;
  }> = [
    {
      value: "light",
      title: "Clair",
      description: "Fond lumineux, idéal en environnement bien éclairé.",
      icon: Sun,
    },
    {
      value: "dark",
      title: "Sombre",
      description: "Fond sombre, plus confortable le soir.",
      icon: Moon,
    },
  ];

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Apparence"
        description="Choisissez le thème de l'interface. Le changement est appliqué immédiatement."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {options.map((option) => {
          const Icon = option.icon;
          const active = theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => set(option.value)}
              aria-pressed={active}
              className={cn(
                "group rounded-xl border bg-surface p-4 text-left transition-colors",
                active
                  ? "border-primary-500 ring-2 ring-primary-500/20"
                  : "border-border hover:border-primary-500/50",
              )}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                      active
                        ? "bg-primary-600 text-white"
                        : "bg-slate-500/10 text-muted",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{option.title}</p>
                    <p className="text-xs text-muted">{option.description}</p>
                  </div>
                </div>
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    active
                      ? "border-primary-600 bg-primary-600 text-white"
                      : "border-border text-transparent",
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
              </div>
              <ThemePreview theme={option.value} />
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aperçu de l'interface</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-border bg-bg p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="h-3 w-32 rounded bg-slate-400/40" />
                <div className="mt-2 h-2 w-48 rounded bg-slate-400/20" />
              </div>
              <span className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white">
                Action
              </span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <div className="h-2 w-16 rounded bg-slate-400/30" />
                  <div className="mt-2 h-3 w-10 rounded bg-slate-400/50" />
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">
            Le thème <strong>{theme === "dark" ? "sombre" : "clair"}</strong> est
            actuellement actif. Votre choix est conservé dans ce navigateur.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
