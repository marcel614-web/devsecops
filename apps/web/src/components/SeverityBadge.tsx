import { clsx } from "clsx";
import type { Severity } from "@/types/api";

const styles: Record<Severity, string> = {
  CRITICAL: "bg-red-700 text-white",
  HIGH: "bg-orange-600 text-white",
  MEDIUM: "bg-amber-500 text-black",
  LOW: "bg-yellow-300 text-black",
  INFO: "bg-slate-500 text-white",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={clsx("inline-block px-2 py-0.5 rounded text-xs font-bold", styles[severity])}>
      {severity}
    </span>
  );
}