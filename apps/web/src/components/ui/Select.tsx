import { clsx } from "clsx";
import type { SelectHTMLAttributes } from "react";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        "w-full px-3 py-2 rounded-md bg-slate-900 border border-border text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500",
        className,
      )}
    />
  );
}