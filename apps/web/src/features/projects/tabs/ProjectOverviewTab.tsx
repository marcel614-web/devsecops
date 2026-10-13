// apps/web/src/features/projects/tabs/ProjectOverviewTab.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { ProjectDetail } from "@/types/api";
import { formatDate } from "@/lib/utils";

export function ProjectOverviewTab({ project }: { project: ProjectDetail }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Informations générales</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <Row label="Identifiant" value={project.id} mono />
            <Row label="Provider" value={project.provider} />
            <Row label="Repo ID" value={project.repoId} mono />
            <Row label="Propriétaire" value={project.owner.name} />
            <Row label="Email propriétaire" value={project.owner.email} />
            <Row label="Créé le" value={formatDate(project.createdAt)} />
            <Row label="Modifié le" value={formatDate(project.updatedAt)} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activité</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Pipelines exécutés</span>
              <span className="font-semibold">{project._count?.pipelines ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Déploiements</span>
              <span className="font-semibold">{project._count?.deployments ?? 0}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right truncate ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}