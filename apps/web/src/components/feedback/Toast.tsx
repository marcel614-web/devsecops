import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; kind: ToastKind; message: string; }

interface ToastCtx {
  show: (kind: ToastKind, message: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const remove = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "flex items-start gap-2 p-3 rounded-md border shadow-lg bg-surface",
              t.kind === "success" && "border-emerald-500/40",
              t.kind === "error" && "border-red-500/40",
              t.kind === "info" && "border-blue-500/40",
            )}
          >
            {t.kind === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />}
            {t.kind === "error" && <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />}
            {t.kind === "info" && <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />}
            <p className="text-sm flex-1">{t.message}</p>
            <button onClick={() => remove(t.id)} className="text-muted hover:text-slate-700 dark:hover:text-slate-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast doit être utilisé dans ToastProvider");
  return ctx;
}