import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/feedback/EmptyState";
import { serverService } from "@/services/server.service";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/components/feedback/Toast";

const KEY = "default-server-id";

export function ServersDefaultPage() {
  const toast = useToast();
  const { data } = useQuery({ queryKey: ["servers"], queryFn: () => serverService.list({ pageSize: 100 }) });
  const items = data?.items ?? [];
  const [selected, setSelected] = useState<string>(localStorage.getItem(KEY) ?? "");

  useEffect(() => {
    setSelected(localStorage.getItem(KEY) ?? "");
  }, []);

  const save = () => {
    localStorage.setItem(KEY, selected);
    toast.show("success", "Serveur par défaut enregistré");
  };

  if (items.length === 0) {
    return (
      <div>
        <PageHeader title="Serveurs par défaut" description="Serveur de déploiement favori" />
        <EmptyState title="Aucun serveur" description="Configurez d'abord un serveur de déploiement." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Serveurs par défaut" description="Serveur de déploiement favori" />
      <Card>
        <CardContent className="space-y-4 py-4">
          <select
            className="w-full px-3 py-2 rounded border border-border bg-background"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Aucun</option>
            {items.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.host}
              </option>
            ))}
          </select>
          <Button onClick={save}>Enregistrer</Button>
        </CardContent>
      </Card>
    </div>
  );
}