// apps/web/src/components/security/SeveritySummaryCards.tsx
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { Severity } from "@/types/api";

interface Props {
  counts: Record<Severity, number>;
  active?: Severity | null;
  onSelect?: (s: Severity | null) => void;
}

const ORDER: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

const STYLES: Record<Severity, { text: string; bg: string; ring: string }> = {
  CRITICAL: {
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
    ring: "ring-red-500/50",
  },
  HIGH: {
    text: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10",
    ring: "ring-orange-500/50",
  },
  MEDIUM: {
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/50",
  },
  LOW: {
    text: "text-yellow-600 dark:text-yellow-400",
    bg: "bg-yellow-300/15",
    ring: "ring-yellow-400/50",
  },
  INFO: {
    text: "text-slate-500",
    bg: "bg-slate-500/10",
    ring: "ring-slate-500/50",
  },
};

export function SeveritySummaryCards({ counts, active, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {ORDER.map((s) => {
        const style = STYLES[s];
        const isActive = active === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onSelect?.(isActive ? null : s)}
            disabled={!onSelect}
            className={cn(
              "text-left transition-all",
              onSelect && "cursor-pointer",
            )}
          >
            <Card
              className={cn(
                "p-3 border",
                isActive && `ring-2 ${style.ring}`,
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted font-medium">{s}</p>
                <span className={cn("w-2 h-2 rounded-full", style.bg)} />
              </div>
              <p className={cn("text-2xl font-bold", style.text)}>{counts[s]}</p>
            </Card>
          </button>
        );
      })}
    </div>
  );
}