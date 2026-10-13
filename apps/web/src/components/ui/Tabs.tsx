// apps/web/src/components/ui/Tabs.tsx
import { cn } from "@/lib/utils";

interface Tab {
  key: string;
  label: string;
  badge?: number;
}

interface Props {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className }: Props) {
  return (
    <div className={cn("flex border-b border-border overflow-x-auto scrollbar-thin", className)}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "px-4 py-2 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors flex items-center gap-1.5",
            active === t.key
              ? "border-primary-500 text-primary-600 dark:text-primary-500 font-medium"
              : "border-transparent text-muted hover:text-slate-700 dark:hover:text-slate-200",
          )}
        >
          {t.label}
          {t.badge !== undefined && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700">
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}