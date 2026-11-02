import { clsx } from "clsx";
import type { PipelineStatus } from "@/types/api";

const styles: Record<PipelineStatus, string> = {
  QUEUED: "bg-slate-700 text-slate-200",
  RUNNING: "bg-blue-600 text-white animate-pulse",
  SUCCESS: "bg-emerald-600 text-white",
  SUCCESS_WITH_WARNINGS: "bg-amber-500 text-slate-900",
  FAILED: "bg-red-600 text-white",
  SECURITY_BLOCKED: "bg-amber-600 text-white",
  CANCELLED: "bg-slate-600 text-slate-300",
  TIMED_OUT: "bg-orange-600 text-white",
  WAITING_APPROVAL: "bg-sky-600 text-white",
};

export function StatusBadge({ status }: { status: PipelineStatus }) {
  return (
    <span className={clsx("inline-block px-2 py-0.5 rounded text-xs font-medium", styles[status])}>
      {status}
    </span>
  );
}