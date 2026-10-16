import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { auditService } from "@/services/audit.service";
import { getErrorMessage } from "@/services/api";
import { useQuery } from "@tanstack/react-query";
import { timeAgo } from "@/lib/utils";

export function AuditPage() {
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["audit-logs", applied],
    queryFn: () => auditService.list({ pageSize: 50, search: applied || undefined }),
    refetchInterval: 10_000,
  });

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader title="Journal d'audit" description="Historique des actions administratives" />
      <div className="mb-4 flex gap-2 max-w-md">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher..." />
        <Button onClick={() => setApplied(search)}>Filtrer</Button>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </CardContent>
        </Card>
      )}

      {isError && (
        <ErrorState title="Impossible de charger l'audit" description={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState title="Aucune entrée" description="Le journal d'audit est vide pour ces critères." />
      )}

      {!isLoading && !isError && items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-muted border-b border-border">
                <tr>
                  <th className="text-left py-2 px-4 font-medium">Date</th>
                  <th className="text-left py-2 px-4 font-medium">Utilisateur</th>
                  <th className="text-left py-2 px-4 font-medium">Action</th>
                  <th className="text-left py-2 px-4 font-medium">Cible</th>
                </tr>
              </thead>
              <tbody>
                {items.map(( entry: any) => (
                  <tr key={entry.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 px-4 text-muted">{timeAgo(entry.createdAt)}</td>
                    <td className="py-2.5 px-4">{entry.user?.name ?? entry.user?.email ?? "—"}</td>
                    <td className="py-2.5 px-4 font-mono text-xs">{entry.action}</td>
                    <td className="py-2.5 px-4 text-xs">
                      {entry.targetType ? `${entry.targetType}${entry.targetId ? `:${entry.targetId.slice(0, 8)}` : ""}` : "—"}
                    </td>
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