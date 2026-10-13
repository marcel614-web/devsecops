import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { pipelinesApi } from "@/services/pipelines.api";

interface Props { projectId: string; pipelineId: string; stepId: string | null; }

const levelClass = {
  info: "text-slate-300",
  warn: "text-amber-400",
  error: "text-red-400",
  debug: "text-slate-500",
};

export function LogViewer({ projectId, pipelineId, stepId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["logs", projectId, pipelineId, stepId],
    queryFn: () => pipelinesApi.logs(projectId, pipelineId, {
      pageSize: 1000,
      stepId: stepId ?? undefined,
    }),
    refetchInterval: 3_000,
  });

  if (isLoading) return <p className="text-slate-500 text-sm">Chargement des logs…</p>;

  return (
    <div className="h-96 overflow-y-auto scrollbar-thin bg-slate-950 rounded border border-border p-3 font-mono text-xs leading-relaxed">
      {data?.items.map((l) => (
        <div key={l.id} className="flex gap-3">
          <span className="text-slate-600 select-none w-10 text-right">{l.sequence}</span>
          <span className={clsx("flex-1 whitespace-pre-wrap", levelClass[l.level])}>
            {l.message}
          </span>
        </div>
      ))}
      {data?.items.length === 0 && (
        <p className="text-slate-500">Aucun log {stepId ? "pour cette étape" : ""}.</p>
      )}
    </div>
  );
}