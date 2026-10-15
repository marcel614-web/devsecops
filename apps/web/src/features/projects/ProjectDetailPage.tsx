// apps/web/src/features/projects/ProjectDetailPage.tsx
import { useParams, Link, useSearchParams, Navigate } from "react-router-dom";
import { Play } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/feedback/Toast";
import { useProject } from "@/hooks/useProjects";
import { pipelineService } from "@/services/pipeline.service";
import { getErrorMessage } from "@/services/api";
import { ProjectOverviewTab } from "./tabs/ProjectOverviewTab";
import { ProjectPipelinesTab } from "./tabs/ProjectPipelinesTab";
import { ProjectConfigTab } from "./tabs/ProjectConfigTab";
import { ProjectVulnerabilitiesTab } from "./tabs/ProjectVulnerabilitiesTab";

const TABS = [
  { key: "overview", label: "Vue d'ensemble" },
  { key: "pipelines", label: "Pipelines" },
  { key: "vulnerabilities", label: "Vulnérabilités" },
  { key: "config", label: "Configuration" },
];

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const active = searchParams.get("tab") ?? "pipelines";
  const toast = useToast();
  const qc = useQueryClient();

  const { data: project, isLoading, isError, error, refetch } = useProject(projectId);

  // ------------------------------------------------------------
  // Mutation : lancer un pipeline
  // ------------------------------------------------------------
  const runMutation = useMutation({
    mutationFn: () => pipelineService.run(projectId!, {}),
    onSuccess: (pipeline) => {
      toast.show(
        "success",
        `Pipeline ${pipeline.id.slice(0, 8)} lancé`,
      );
      // Rafraîchit la liste des pipelines du projet
      qc.invalidateQueries({ queryKey: ["project-pipelines", projectId] });
      qc.invalidateQueries({ queryKey: ["global-pipelines"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => {
      toast.show("error", getErrorMessage(err));
    },
  });

  if (isLoading) {
    return (
      <div>
        <Skeleton className="h-10 w-64 mb-4" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (isError || !project) {
    return (
      <ErrorState
        title="Projet introuvable"
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  const handleTab = (k: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", k);
    setSearchParams(next);
  };

  const handleRunPipeline = () => {
    runMutation.mutate();
  };

  return (
    <div>
      <PageHeader
        title={project.name}
        description={
          project.description ??
          `${project.repoFullName} · ${project.defaultBranch}`
        }
        actions={
          <Button
            onClick={handleRunPipeline}
            loading={runMutation.isPending}
            disabled={runMutation.isPending}
          >
            <Play className="w-4 h-4" />
            {runMutation.isPending ? "Lancement…" : "Lancer un pipeline"}
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
          <Info label="Repository" value={project.repoFullName} mono />
          <Info label="Technologie" value={project.technology} />
          <Info label="Branche" value={project.defaultBranch} />
          <Info
            label="Déploiement"
            value={project.deploymentEnabled ? "Activé" : "Désactivé"}
          />
        </CardContent>
      </Card>

      <Tabs
        tabs={[
          ...TABS.map((t) => ({
            ...t,
            badge:
              t.key === "pipelines" ? project._count?.pipelines : undefined,
          })),
        ]}
        active={active}
        onChange={handleTab}
        className="mb-6"
      />

      {active === "overview" && <ProjectOverviewTab project={project} />}
      {active === "pipelines" && <ProjectPipelinesTab projectId={project.id} />}
      {active === "vulnerabilities" && (
        <ProjectVulnerabilitiesTab projectId={project.id} />
      )}
      {active === "config" && <ProjectConfigTab project={project} />}

      {!TABS.some((t) => t.key === active) && (
        <Navigate to={`/projects/${project.id}?tab=pipelines`} replace />
      )}
    </div>
  );
}

function Info({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted mb-0.5">{label}</p>
      <p className={`text-sm truncate ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}