import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, Copy, Check, Download, Search, WrapText } from "lucide-react";
import { cn } from "@/lib/utils";
import { pipelinesApi } from "@/services/pipelines.api";

interface Props {
  projectId: string;
  pipelineId: string;
  stepId: string | null;
  /** Arrête le polling quand le pipeline est terminé */
  isRunning?: boolean;
}

type Level = "info" | "warn" | "error" | "debug";

const LEVELS: { key: Level | "all"; label: string }[] = [
  { key: "all", label: "Tout" },
  { key: "error", label: "Erreurs" },
  { key: "warn", label: "Alertes" },
  { key: "info", label: "Info" },
  { key: "debug", label: "Debug" },
];

const levelClass: Record<string, string> = {
  info: "text-slate-300",
  warn: "text-amber-400",
  error: "text-red-400",
  debug: "text-slate-500",
};

export function LogViewer({ projectId, pipelineId, stepId, isRunning = true }: Props) {
  const [level, setLevel] = useState<Level | "all">("all");
  const [query, setQuery] = useState("");
  const [wrap, setWrap] = useState(true);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["logs", projectId, pipelineId, stepId],
    queryFn: () =>
      pipelinesApi.logs(projectId, pipelineId, { pageSize: 1000, stepId: stepId ?? undefined }),
    refetchInterval: isRunning ? 3_000 : false,
  });

  const all = data?.items ?? [];
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (l) => (level === "all" || l.level === level) && (!q || l.message.toLowerCase().includes(q)),
    );
  }, [all, level, query]);

  // Suivi automatique de la fin des logs
  useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [items.length, follow]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };

  const text = () => items.map((l) => l.message).join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text()], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `pipeline-${pipelineId.slice(0, 8)}${stepId ? `-${stepId.slice(0, 6)}` : ""}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const iconBtn =
    "rounded-md p-1.5 text-muted transition-colors hover:bg-slate-200/70 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-slate-700 dark:hover:text-slate-100";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-slate-950">
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div role="tablist" aria-label="Niveau de log" className="flex gap-1">
          {LEVELS.map((l) => (
            <button
              key={l.key}
              role="tab"
              aria-selected={level === l.key}
              onClick={() => setLevel(l.key)}
              className={cn(
                "rounded px-2 py-1 text-xs transition-colors",
                level === l.key ? "bg-primary-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>

        <div className="relative ml-auto min-w-[140px] flex-1 sm:max-w-[220px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer…"
            aria-label="Filtrer les logs"
            className="w-full rounded-md border border-slate-700 bg-slate-950 py-1 pl-7 pr-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-0.5 text-slate-400">
          <button type="button" className={cn(iconBtn, wrap && "bg-slate-800 text-slate-100")} onClick={() => setWrap((v) => !v)} title="Retour à la ligne" aria-pressed={wrap}>
            <WrapText className="h-4 w-4" />
          </button>
          <button type="button" className={iconBtn} onClick={copy} title="Copier les logs" disabled={!items.length}>
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
          <button type="button" className={iconBtn} onClick={download} title="Télécharger" disabled={!items.length}>
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Contenu */}
      <div className="relative">
        <div
          ref={boxRef}
          onScroll={onScroll}
          className="scrollbar-thin h-96 overflow-auto p-3 font-mono text-xs leading-relaxed"
          role="log"
          aria-live="off"
        >
          {isLoading && <p className="text-slate-500">Chargement des logs…</p>}
          {isError && <p className="text-red-400">Impossible de charger les logs.</p>}

          {items.map((l) => (
            <div key={l.id} className="flex gap-3 hover:bg-slate-900/70">
              <span className="w-10 shrink-0 select-none text-right text-slate-600">{l.sequence}</span>
              <span className={cn("flex-1", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre", levelClass[l.level] ?? "text-slate-300")}>
                {l.message}
              </span>
            </div>
          ))}

          {!isLoading && !isError && items.length === 0 && (
            <p className="text-slate-500">
              {all.length > 0 ? "Aucun log ne correspond aux filtres." : `Aucun log ${stepId ? "pour cette étape" : "pour le moment"}.`}
            </p>
          )}
        </div>

        {!follow && items.length > 0 && (
          <button
            type="button"
            onClick={() => setFollow(true)}
            className="absolute bottom-3 right-4 inline-flex items-center gap-1.5 rounded-full bg-primary-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-primary-500"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" /> Aller à la fin
          </button>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-500">
        <span className="tabular-nums">{items.length}{items.length !== all.length && ` / ${all.length}`} ligne{items.length > 1 ? "s" : ""}</span>
        {isRunning && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> En direct
          </span>
        )}
      </div>
    </div>
  );
}
