// apps/web/src/components/security/PipelineStage.tsx
import {
  Check,
  X,
  Clock,
  Loader2,
  ShieldAlert,
  MinusCircle,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import type { StepStatus, PipelineStep } from "@/types/api";

const STATUS_CONFIG: Record<
  StepStatus,
  { Icon: typeof Check; className: string; label: string }
> = {
  QUEUED: {
    Icon: Clock,
    className: "text-slate-400",
    label: "En attente",
  },
  RUNNING: {
    Icon: Loader2,
    className: "text-blue-500 animate-spin",
    label: "En cours",
  },
  SUCCESS: {
    Icon: Check,
    className: "text-emerald-500",
    label: "Réussi",
  },
  FAILED: {
    Icon: X,
    className: "text-red-500",
    label: "Échoué",
  },
  SECURITY_BLOCKED: {
    Icon: ShieldAlert,
    className: "text-amber-500",
    label: "Bloqué sécurité",
  },
  CANCELLED: {
    Icon: MinusCircle,
    className: "text-slate-500",
    label: "Non exécuté",
  },
};

interface Props {
  step: PipelineStep;
  selected: boolean;
  onSelect: () => void;
}

export function PipelineStage({ step, selected, onSelect }: Props) {
  const cfg = STATUS_CONFIG[step.status] ?? {
    Icon: MinusCircle,
    className: "text-slate-500",
    label: step.status,
  };
  const Icon = cfg.Icon;

  const hasError = !!step.error && (step.status === "FAILED" || step.status === "SECURITY_BLOCKED");

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors",
        selected
          ? "bg-primary-600/15 border border-primary-500/40"
          : hasError
            ? "border border-red-500/30 bg-red-500/5 hover:bg-red-500/10"
            : "border border-transparent hover:bg-slate-100 dark:hover:bg-slate-700/40",
      )}
    >
      <div className="flex items-center justify-center w-6 h-6 shrink-0">
        <Icon className={cn("w-4 h-4", cfg.className)} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium truncate">
            <span className="text-muted mr-2">{step.order}.</span>
            {step.name}
          </p>
          {hasError && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 font-semibold flex items-center gap-1">
              <AlertCircle className="w-2.5 h-2.5" />
              À corriger
            </span>
          )}
        </div>
        <p className="text-xs text-muted truncate">
          {cfg.label}
          {step.durationMs != null && ` · ${formatDuration(step.durationMs)}`}
          {hasError && step.error && ` · ${step.error.slice(0, 60)}${step.error.length > 60 ? "…" : ""}`}
        </p>
      </div>

      <ChevronRight className="w-3.5 h-3.5 text-muted shrink-0" />
    </button>
  );
}