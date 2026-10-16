import { Rocket, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { ProjectDetail } from "@/types/api";
import { formatDate } from "@/lib/utils";

export function ProjectOverviewTab({ project }: { project: ProjectDetail }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Informations générales</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border/60 text-sm">
            <Row label="Identifiant" value={project.id} mono />
            <Row label="Fournisseur Git" value={project.provider} />
            <Row label="ID du dépôt" value={project.repoId} mono />
            <Row label="Propriétaire" value={project.owner.name} />
            <Row label="Email" value={project.owner.email} />
            <Row label="Créé le" value={formatDate(project.createdAt)} />
            <Row label="Modifié le" value={formatDate(project.updatedAt)} />
          </dl>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Stat icon={<Play className="h-4 w-4" />} label="Pipelines exécutés" value={project._count?.pipelines ?? 0} />
        <Stat icon={<Rocket className="h-4 w-4" />} label="Déploiements" value={project._count?.deployments ?? 0} />
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600/10 text-primary-600 dark:text-primary-400">
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums leading-none">{value}</p>
          <p className="mt-1 text-xs text-muted">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={`truncate text-right ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</dd>
    </div>
  );
}
