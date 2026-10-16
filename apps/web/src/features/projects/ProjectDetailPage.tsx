// apps/web/src/features/projects/ProjectDetailPage.tsx
import { useParams, Link, useSearchParams, Navigate } from "react-router-dom";
import { Play, GitBranch, Shield, Rocket, Settings2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { SimpleBadge } from "@/components/ui/Badge";
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
import { useThemeStore } from "@/stores/themeStore";

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

  const runMutation = useMutation({
    mutationFn: () => pipelineService.run(projectId!, {}),
    onSuccess: (pipeline) => {
      toast.show("success", `Pipeline ${pipeline.id.slice(0, 8)} lancé`);
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
      <div className="space-y-4">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
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

  const initials = (project.name ?? "?")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-6">
      {/* HERO */}
      <Card className="overflow-hidden border-primary-500/20">
        <div className="relative bg-gradient-to-br from-primary-600/10 via-transparent to-blue-600/5 px-6 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4 min-w-0">
              <div className="w-14 h-14 shrink-0 rounded-2xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center text-primary-600 dark:text-primary-400 font-bold text-lg">
                {initials}
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold truncate">{project.name}</h1>
                <p className="text-sm text-muted truncate font-mono mt-1">
                  {project.repoFullName}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <SimpleBadge className="bg-blue-500/15 text-blue-600 dark:text-blue-400">{project.technology}</SimpleBadge>
                  <SimpleBadge className="bg-slate-200/70 text-slate-700 dark:text-slate-300">{project.defaultBranch}</SimpleBadge>
                  {project.deploymentEnabled ? (
                    <SimpleBadge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Déploiement actif</SimpleBadge>
                  ) : (
                    <SimpleBadge className="bg-slate-200/70 text-slate-700 dark:text-slate-300">Déploiement désactivé</SimpleBadge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => runMutation.mutate()}
                loading={runMutation.isPending}
                disabled={runMutation.isPending}
                className="gap-2"
              >
                <Play className="w-4 h-4" />
                {runMutation.isPending ? "Lancement…" : "Lancer un pipeline"}
              </Button>
              <Link to={`/projects/${project.id}?tab=config`}>
                <Button variant="outline" className="gap-2">
                  <Settings2 className="w-4 h-4" />
                  Configurer
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 py-5 border-t border-border/60">
          <Info label="Repository" value={project.repoFullName} mono icon={<GitBranch className="w-3.5 h-3.5" />} />
          <Info label="Technologie" value={project.technology} icon={<Shield className="w-3.5 h-3.5" />} />
          <Info label="Branche par défaut" value={project.defaultBranch} />
          <Info
            label="Pipelines"
            value={String(project._count?.pipelines ?? 0)}
            icon={<Rocket className="w-3.5 h-3.5" />}
          />
        </CardContent>
      </Card>

      {/* TABS */}
      <Tabs
        tabs={TABS.map((t) => ({
          ...t,
          badge:
            t.key === "pipelines"
              ? project._count?.pipelines
              : t.key === "vulnerabilities"
                ? undefined
                : undefined,
        }))}
        active={active}
        onChange={handleTab}
        className="border-b-0 mb-4"
      />

      {/* CONTENT */}
      <Card className="min-h-[300px]">
        <CardContent className="py-5">
          {active === "overview" && <ProjectOverviewTab project={project} />}
          {active === "pipelines" && <ProjectPipelinesTab projectId={project.id} />}
          {active === "vulnerabilities" && <ProjectVulnerabilitiesTab projectId={project.id} />}
          {active === "config" && <ProjectConfigTab project={project} />}
        </CardContent>
      </Card>

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
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-100/60 dark:bg-slate-800/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted mb-1">
        {icon}
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-sm font-medium truncate ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}
