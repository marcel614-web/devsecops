import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { authService } from "@/services/auth.service";
import { auditService } from "@/services/audit.service";
import { useQuery } from "@tanstack/react-query";
import { timeAgo } from "@/lib/utils";

export function SecurityPage() {
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: () => authService.me() });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["my-audit", user?.id],
    queryFn: () => auditService.list({ pageSize: 20 }),
    enabled: !!user,
    refetchInterval: 15_000,
  });

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader title="Sécurité" description="Historique de connexion et d'actions sensibles" />
      <Card>
        <CardContent className="py-4">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          )}
          {isError && (
            <ErrorState title="Impossible de charger l'historique" description={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
          )}
          {!isLoading && !isError && items.length === 0 && (
            <EmptyState title="Aucun historique" description="Les connexions et actions sensibles apparaîtront ici." />
          )}
          {!isLoading && !isError && items.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-muted border-b border-border">
                <tr>
                  <th className="text-left py-2 px-4 font-medium">Date</th>
                  <th className="text-left py-2 px-4 font-medium">Action</th>
                  <th className="text-left py-2 px-4 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e: any) => (
                  <tr key={e.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 px-4 text-muted">{timeAgo(e.createdAt)}</td>
                    <td className="py-2 px-4 font-mono text-xs">{e.action}</td>
                    <td className="py-2 px-4 text-xs">{e.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}