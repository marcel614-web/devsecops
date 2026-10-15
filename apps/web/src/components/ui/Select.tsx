// apps/web/src/components/ui/Select.tsx
import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "w-full px-3 py-2 rounded-md bg-surface border border-border text-slate-800 dark:text-slate-100",
      "focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";