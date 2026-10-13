// apps/web/src/components/security/PipelineStage.tsx
import {
  Check,
  X,
  Clock,
  Loader2,
  ShieldAlert,
  MinusCircle,
  ChevronRight,
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

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors",
        selected
          ? "bg-primary-600/15 border border-primary-500/40"
          : "border border-transparent hover:bg-slate-100 dark:hover:bg-slate-700/40",
      )}
    >
      <div className="flex items-center justify-center w-6 h-6 shrink-0">
        <Icon className={cn("w-4 h-4", cfg.className)} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          <span className="text-muted mr-2">{step.order}.</span>
          {step.name}
        </p>
        <p className="text-xs text-muted">
          {cfg.label}
          {step.durationMs != null && ` · ${formatDuration(step.durationMs)}`}
        </p>
      </div>

      <ChevronRight className="w-3.5 h-3.5 text-muted shrink-0" />
    </button>
  );
}