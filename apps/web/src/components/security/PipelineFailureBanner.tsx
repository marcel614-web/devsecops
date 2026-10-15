// apps/web/src/components/security/PipelineFailureBanner.tsx
import {
  AlertCircle,
  ShieldAlert,
  Lightbulb,
  ArrowRight,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { FailureInfo } from "@/lib/pipelineFailure";

interface Props {
  failure: FailureInfo;
  projectId?: string;
}

export function PipelineFailureBanner({ failure, projectId }: Props) {
  const isBlocked = failure.severity === "blocked";

  const config = isBlocked
    ? {
        Icon: ShieldAlert,
        bg: "bg-amber-500/5 border-amber-500/40",
        iconBg: "bg-amber-500/15",
        iconColor: "text-amber-500",
        titleColor: "text-amber-600 dark:text-amber-400",
        title: "Pipeline bloqué par le Security Gate",
      }
    : {
        Icon: AlertCircle,
        bg: "bg-red-500/5 border-red-500/40",
        iconBg: "bg-red-500/15",
        iconColor: "text-red-500",
        titleColor: "text-red-600 dark:text-red-400",
        title: "Échec du pipeline",
      };

  const showConfigLink =
    projectId &&
    (failure.stepType === "DOCKER_BUILD" || failure.stepType === "SECURITY_GATE");

  return (
    <div className={cn("rounded-lg border p-4 mb-4", config.bg)}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
            config.iconBg,
          )}
        >
          <config.Icon className={cn("w-5 h-5", config.iconColor)} />
        </div>

        <div className="flex-1 min-w-0">
          <p className={cn("text-sm font-semibold", config.titleColor)}>
            {config.title}
          </p>

          <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">
            <span className="font-medium">Étape en cause :</span>{" "}
            {failure.stepName}
          </p>

          <pre className="mt-2 text-xs font-mono whitespace-pre-wrap break-words bg-slate-950 rounded p-2 max-h-32 overflow-y-auto scrollbar-thin text-slate-300">
            {failure.error}
          </pre>

          {failure.hint && (
            <div className="mt-3 flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 rounded p-2.5">
              <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0 text-yellow-500" />
              <div className="flex-1">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Comment corriger :
                </span>{" "}
                {failure.hint}
                {showConfigLink && (
                  <Link
                    to={`/projects/${projectId}?tab=config`}
                    className="ml-1 inline-flex items-center gap-1 text-primary-500 hover:underline"
                  >
                    Ouvrir la configuration
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}