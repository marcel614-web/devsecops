import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import type { SecurityGateStatus } from "@/types/api";

export function SecurityGateBadge({ status }: { status: SecurityGateStatus }) {
  if (status === "PASSED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-600 text-white text-sm font-medium">
        <ShieldCheck className="w-4 h-4" /> Security Gate PASSED
      </span>
    );
  }
  if (status === "BLOCKED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-red-600 text-white text-sm font-medium">
        <ShieldAlert className="w-4 h-4" /> Security Gate BLOCKED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-600 text-white text-sm font-medium">
      <Shield className="w-4 h-4" /> {status}
    </span>
  );
}