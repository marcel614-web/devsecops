// apps/web/src/components/security/PipelineLogs.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Copy,
  ArrowDown,
  ArrowUp,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/feedback/Toast";
import { usePipelineLogs } from "@/hooks/usePipeline";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  pipelineId: string;
  stepId: string | null;
  isRunning: boolean;
}

const LEVEL_CLASS: Record<string, string> = {
  info: "text-slate-700 dark:text-slate-300",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
  debug: "text-slate-500",
};

export function PipelineLogs({
  projectId,
  pipelineId,
  stepId,
  isRunning,
}: Props) {
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const { data, isLoading, isError, error } = usePipelineLogs(
    projectId,
    pipelineId,
    { stepId: stepId ?? undefined, level: levelFilter ?? undefined },
    isRunning,
  );

  const logs = data?.items ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return logs;
    const s = search.toLowerCase();
    return logs.filter((l) => l.message.toLowerCase().includes(s));
  }, [logs, search]);

  // Autoscroll quand de nouveaux logs arrivent
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  // Détecte si l'utilisateur scrolle vers le haut → désactive l'autoscroll
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const handleCopy = async () => {
    const text = filtered
      .map((l) => `[${l.level}] ${l.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.show("success", `${filtered.length} ligne(s) copiée(s)`);
    } catch {
      toast.show("error", "Impossible de copier dans le presse-papiers");
    }
  };

  return (
    <Card className="flex flex-col h-full min-h-[400px]">
      <CardHeader className="flex flex-col gap-3 !pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-sm">
            Logs d'exécution
            {isRunning && (
              <span className="flex items-center gap-1 text-xs text-primary-500 font-normal">
                <Loader2 className="w-3 h-3 animate-spin" /> en direct
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAutoScroll((v) => !v)}
              title={
                autoScroll
                  ? "Désactiver l'auto-scroll"
                  : "Activer l'auto-scroll"
              }
            >
              {autoScroll ? (
                <ArrowDown className="w-3.5 h-3.5" />
              ) : (
                <ArrowUp className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              title="Copier les logs"
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher dans les logs…"
              className="pl-8 h-8 text-xs"
            />
          </div>

          <div className="flex gap-1">
            {(["info", "warn", "error", "debug"] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() =>
                  setLevelFilter(levelFilter === lvl ? null : lvl)
                }
                className={cn(
                  "px-2 py-1 text-[11px] rounded transition-colors",
                  levelFilter === lvl
                    ? "bg-primary-600 text-white"
                    : "bg-slate-200 dark:bg-slate-700 text-muted hover:bg-slate-300 dark:hover:bg-slate-600",
                )}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 flex-1 min-h-0">
        {isLoading && (
          <div className="p-4 text-center text-sm text-muted">
            Chargement des logs…
          </div>
        )}

        {isError && (
          <div className="p-4 flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="w-4 h-4" />
            {error instanceof Error
              ? error.message
              : "Erreur de chargement"}
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-muted">
            {logs.length === 0
              ? stepId
                ? "Aucun log pour cette étape."
                : "Aucun log disponible."
              : "Aucun résultat pour ce filtre."}
          </div>
        )}

        {filtered.length > 0 && (
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="h-[420px] overflow-y-auto scrollbar-thin bg-slate-950 rounded-b-lg p-3 font-mono text-xs leading-relaxed"
          >
            {filtered.map((l) => (
              <div
                key={l.id}
                className="flex gap-2 hover:bg-slate-900/60 py-0.5 px-1 rounded"
              >
                <span className="text-slate-600 select-none w-10 text-right shrink-0">
                  {l.sequence}
                </span>
                <span
                  className="text-slate-500 shrink-0 w-32 truncate"
                  title={l.step?.name}
                >
                  {l.step ? l.step.name : "pipeline"}
                </span>
                <span
                  className={cn(
                    "flex-1 whitespace-pre-wrap break-words",
                    LEVEL_CLASS[l.level],
                  )}
                >
                  {l.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}