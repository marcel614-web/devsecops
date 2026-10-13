// apps/web/src/features/projects/tabs/ProjectVulnerabilitiesTab.tsx
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/Card";
import { SeverityBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { vulnerabilityService } from "@/services/vulnerability.service";
import { timeAgo } from "@/lib/utils";

export function ProjectVulnerabilitiesTab({ projectId }: { projectId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["project-vulnerabilities", projectId],
    queryFn: () => vulnerabilityService.listByProject(projectId, { pageSize: 50 }),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        title="Impossible de charger les vulnérabilités"
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 border-b border-border">
          {(Object.keys(data.severityCounts) as Array<keyof typeof data.severityCounts>).map(
            (k) => (
              <div key={k} className="text-center">
                <p className="text-xs text-muted">{k}</p>
                <p className="text-xl font-bold">{data.severityCounts[k]}</p>
              </div>
            ),
          )}
        </div>

        {data.items.length === 0 ? (
          <EmptyState
            title="Aucune vulnérabilité détectée"
            description="Lance un pipeline pour analyser le projet."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted border-b border-border">
                <tr>
                  <th className="text-left py-2 px-4 font-medium">Sévérité</th>
                  <th className="text-left py-2 px-4 font-medium">Outil</th>
                  <th className="text-left py-2 px-4 font-medium">Package / Fichier</th>
                  <th className="text-left py-2 px-4 font-medium">Description</th>
                  <th className="text-right py-2 px-4 font-medium">Détecté</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-border/60 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-700/30"
                  >
                    <td className="py-2.5 px-4">
                      <SeverityBadge severity={v.severity} />
                    </td>
                    <td className="py-2.5 px-4 text-xs text-muted">{v.tool}</td>
                    <td className="py-2.5 px-4 font-mono text-xs">
                      {v.packageName ?? v.filePath?.split("\\").pop() ?? "—"}
                    </td>
                    <td className="py-2.5 px-4 max-w-md">
                      {v.reference ? (
                        <a
                          href={v.reference}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-primary-500 truncate block"
                          title={v.description ?? ""}
                        >
                          {v.description}
                        </a>
                      ) : (
                        <span className="truncate block">{v.description}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right text-xs text-muted">
                      {timeAgo(v.detectedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}