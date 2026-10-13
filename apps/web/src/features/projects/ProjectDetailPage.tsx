import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { projectsApi } from "@/services/projects.api";
import { pipelinesApi } from "@/services/pipelines.api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDuration, timeAgo } from "@/utils/format";

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "pipelines" | "config">("pipelines");

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  });

  const { data: pipelines } = useQuery({
    queryKey: ["pipelines", projectId],
    queryFn: () => pipelinesApi.list(projectId!, { pageSize: 20 }),
    enabled: !!projectId,
    refetchInterval: 5_000,
  });

  const runMutation = useMutation({
    mutationFn: () => pipelinesApi.run(projectId!, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipelines", projectId] });
    },
  });

  if (!project) return <p>Chargement…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-slate-400 font-mono text-sm mt-1">{project.repoFullName} · {project.defaultBranch}</p>
        </div>
        <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
          <Play className="w-4 h-4" /> {runMutation.isPending ? "Lancement…" : "Lancer un pipeline"}
        </Button>
      </div>

      <div className="flex gap-2 border-b border-border">
        {(["pipelines", "overview", "config"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t ? "border-blue-500 text-white" : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {t === "pipelines" ? "Pipelines" : t === "overview" ? "Vue d'ensemble" : "Configuration"}
          </button>
        ))}
      </div>

      {tab === "pipelines" && (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-slate-400 border-b border-border">
              <tr>
                <th className="text-left py-2 px-2">Commit</th>
                <th className="text-left py-2 px-2">Branche</th>
                <th className="text-left py-2 px-2">Statut</th>
                <th className="text-right py-2 px-2">Durée</th>
                <th className="text-right py-2 px-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {pipelines?.items.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-slate-800/40">
                  <td className="py-2 px-2">
                    <Link to={`/projects/${projectId}/pipelines/${p.id}`} className="font-mono text-xs text-blue-400 hover:underline">
                      {p.commitSha.slice(0, 10)}
                    </Link>
                  </td>
                  <td className="py-2 px-2">{p.branch}</td>
                  <td className="py-2 px-2"><StatusBadge status={p.status} /></td>
                  <td className="py-2 px-2 text-right">{formatDuration(p.durationMs)}</td>
                  <td className="py-2 px-2 text-right text-slate-400">{timeAgo(p.createdAt)}</td>
                </tr>
              ))}
              {pipelines?.items.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-slate-500">Aucun pipeline. Lance-en un.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "overview" && (
        <Card>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-slate-400">Technologie</dt><dd>{project.technology}</dd></div>
            <div><dt className="text-slate-400">Provider</dt><dd>{project.provider}</dd></div>
            <div><dt className="text-slate-400">Description</dt><dd>{project.description ?? "—"}</dd></div>
            <div><dt className="text-slate-400">Déploiement activé</dt><dd>{project.deploymentEnabled ? "Oui" : "Non"}</dd></div>
          </dl>
        </Card>
      )}

      {tab === "config" && project.config && (
        <Card>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-slate-400">Branches de déclenchement</dt><dd>{project.config.triggerBranches.join(", ")}</dd></div>
            <div><dt className="text-slate-400">Gitleaks</dt><dd>{project.config.gitleaksEnabled ? "Activé" : "Désactivé"}</dd></div>
            <div><dt className="text-slate-400">Semgrep</dt><dd>{project.config.semgrepEnabled ? "Activé" : "Désactivé"}</dd></div>
            <div><dt className="text-slate-400">SCA</dt><dd>{project.config.scaEnabled ? "Activé" : "Désactivé"}</dd></div>
            <div><dt className="text-slate-400">Trivy</dt><dd>{project.config.trivyEnabled ? "Activé" : "Désactivé"}</dd></div>
            <div><dt className="text-slate-400">ZAP</dt><dd>{project.config.zapEnabled ? "Activé" : "Désactivé"}</dd></div>
            <div><dt className="text-slate-400">Seuils Security Gate</dt>
              <dd>C:{project.config.securityGateCritical} H:{project.config.securityGateHigh} M:{project.config.securityGateMedium} L:{project.config.securityGateLow === -1 ? "∞" : project.config.securityGateLow}</dd>
            </div>
          </dl>
        </Card>
      )}
    </div>
  );
}