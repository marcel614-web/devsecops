// apps/web/src/components/ui/Input.tsx
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "w-full h-9 px-3 rounded-md bg-surface border border-border text-slate-800 dark:text-slate-100",
      "placeholder:text-muted",
      "focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";