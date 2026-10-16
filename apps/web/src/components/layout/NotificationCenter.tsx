import { useState, useRef, useEffect } from "react";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { notificationService, type AppNotification } from "@/services/notification.service";
import { timeAgo } from "@/lib/utils";

const KIND_CLASS: Record<AppNotification["kind"], string> = {
  success: "text-emerald-600",
  warning: "text-amber-600",
  danger: "text-red-600",
  info: "text-slate-600",
};

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: notificationService.list,
    refetchInterval: 30_000,
  });

  const items = data ?? [];

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
        {items.length > 0 && (
          <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-red-500" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-surface border border-border rounded-lg shadow-xl overflow-hidden z-50">
          <div className="px-4 py-2.5 border-b border-border">
            <p className="font-medium text-sm">Notifications</p>
          </div>
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {items.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">Aucune notification.</p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className="px-4 py-3 border-b border-border/60 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/40"
                >
                  {n.link ? (
                    <Link to={n.link} onClick={() => setOpen(false)} className={`text-sm ${KIND_CLASS[n.kind]}`}>
                      {n.title}
                    </Link>
                  ) : (
                    <p className={`text-sm ${KIND_CLASS[n.kind]}`}>{n.title}</p>
                  )}
                  <p className="text-xs text-muted mt-0.5">{timeAgo(n.time)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}