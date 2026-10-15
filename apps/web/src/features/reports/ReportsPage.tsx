import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { reportService } from "@/services/report.service";
import { getErrorMessage } from "@/services/api";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { timeAgo } from "@/lib/utils";

export function ReportsPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["reports"],
    queryFn: () => reportService.list({ pageSize: 50 }),
  });

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader title="Rapports" description="Rapports de sécurité générés par les pipelines" />
      {isLoading && (
        <Card>
          <CardContent className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </CardContent>
        </Card>
      )}
      {isError && (
        <ErrorState
          title="Impossible de charger les rapports"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}
      {!isLoading && !isError && items.length === 0 && (
        <EmptyState icon={FileText} title="Aucun rapport" description="Les pipelines terminés génèrent des rapports ici." />
      )}
      {!isLoading && !isError && items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-muted border-b border-border">
                <tr>
                  <th className="text-left py-2 px-4 font-medium">Projet</th>
                  <th className="text-left py-2 px-4 font-medium">Pipeline</th>
                  <th className="text-left py-2 px-4 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 px-4">{r.project?.name ?? r.projectId}</td>
                    <td className="py-2.5 px-4 font-mono text-xs">{r.pipeline?.commitSha?.slice(0, 10) ?? r.pipelineId}</td>
                    <td className="py-2.5 px-4 text-muted">{timeAgo(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}