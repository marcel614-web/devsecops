import { useState, useRef, useEffect } from "react";
import { Bell } from "lucide-react";

// ⚠️ PHASE 2 : données de démo. En Phase 4 on branchera l'API.
const DEMO_NOTIFICATIONS = [
  { id: "1", title: "Pipeline #142 terminé", time: "il y a 5 min", kind: "success" },
  { id: "2", title: "Security Gate a bloqué le pipeline #141", time: "il y a 1 h", kind: "warning" },
  { id: "3", title: "3 vulnérabilités HIGH détectées", time: "il y a 3 h", kind: "danger" },
];

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-md flex items-center justify-center text-muted hover:bg-slate-200/70 dark:hover:bg-slate-700/60 relative"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-red-500" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-surface border border-border rounded-lg shadow-xl overflow-hidden z-50">
          <div className="px-4 py-2.5 border-b border-border">
            <p className="font-medium text-sm">Notifications</p>
          </div>
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {DEMO_NOTIFICATIONS.map((n) => (
              <div
                key={n.id}
                className="px-4 py-3 border-b border-border/60 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/40"
              >
                <p className="text-sm">{n.title}</p>
                <p className="text-xs text-muted mt-0.5">{n.time}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}