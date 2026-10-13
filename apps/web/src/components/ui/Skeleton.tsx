// apps/web/src/components/ui/Skeleton.tsx
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse bg-slate-200 dark:bg-slate-700/60 rounded",
        className,
      )}
    />
  );
}