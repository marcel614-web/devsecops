import { Check, X, Clock, ShieldAlert, MinusCircle, Loader2 } from "lucide-react";
import type { StepStatus } from "@/types/api";

export function StepIcon({ status }: { status: StepStatus }) {
  const base = "w-5 h-5";
  switch (status) {
    case "SUCCESS":           return <Check className={`${base} text-emerald-500`} />;
    case "FAILED":            return <X className={`${base} text-red-500`} />;
    case "RUNNING":           return <Loader2 className={`${base} text-blue-500 animate-spin`} />;
    case "QUEUED":            return <Clock className={`${base} text-slate-500`} />;
    case "SECURITY_BLOCKED":  return <ShieldAlert className={`${base} text-amber-500`} />;
    case "CANCELLED":         return <MinusCircle className={`${base} text-slate-600`} />;
  }
}