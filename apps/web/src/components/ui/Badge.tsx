import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldAlert, XCircle, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Status =
  | "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED"
  | "SECURITY_BLOCKED" | "CANCELLED";
type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

const statusStyles: Record<Status, { bg: string; Icon: typeof CheckCircle2; label: string }> = {
  QUEUED:           { bg: "bg-slate-500/15 text-slate-600 dark:text-slate-400",     Icon: Clock,         label: "En attente" },
  RUNNING:          { bg: "bg-blue-500/15 text-blue-600 dark:text-blue-400",        Icon: Loader2,       label: "En cours" },
  SUCCESS:          { bg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2, label: "Succès" },
  FAILED:           { bg: "bg-red-500/15 text-red-600 dark:text-red-400",           Icon: XCircle,       label: "Échoué" },
  SECURITY_BLOCKED: { bg: "bg-amber-500/15 text-amber-600 dark:text-amber-400",     Icon: ShieldAlert,   label: "Bloqué sécurité" },
  CANCELLED:        { bg: "bg-slate-500/15 text-slate-600 dark:text-slate-400",     Icon: MinusCircle,   label: "Annulé" },
};

const severityStyles: Record<Severity, string> = {
  CRITICAL: "bg-red-700 text-white",
  HIGH:     "bg-orange-600 text-white",
  MEDIUM:   "bg-amber-500 text-black",
  LOW:      "bg-yellow-300 text-black",
  INFO:     "bg-slate-500 text-white",
};

export function StatusBadge({ status }: { status: Status }) {
  const s = statusStyles[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium", s.bg)}>
      <s.Icon className={cn("w-3.5 h-3.5", status === "RUNNING" && "animate-spin")} />
      {s.label}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold", severityStyles[severity])}>
      {severity === "CRITICAL" && <AlertTriangle className="w-3 h-3" />}
      {severity}
    </span>
  );
}

export function SimpleBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300", className)}>
      {children}
    </span>
  );
}