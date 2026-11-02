import { useState } from "react";
import { useParams, Link, useSearchParams, Navigate } from "react-router-dom";
import { Play, GitBranch, Shield, Rocket, Settings2, ChevronRight, Copy, Check, Github } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { ProjectResilienceTab } from "./tabs/ProjectResilienceTab";

const TABS = [
  { key: "overview", label: "Vue d'ensemble" },
  { key: "pipelines", label: "Pipelines" },
  { key: "vulnerabilities", label: "Vulnérabilités" },
  { key: "resilience", label: "Résilience" },
  { key: "config", label: "Configuration" },
];

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const active = searchParams.get("tab") ?? "pipelines";
  const toast = useToast();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data: project, isLoading, isError, error, refetch } = useProject(projectId);

  const runMutation = useMutation({
    mutationFn: () => pipelineService.run(projectId!, {}),
    onSuccess: (pipeline) => {
      toast.show("success", `Pipeline ${pipeline.id.slice(0, 8)} lancé`);
      qc.invalidateQueries({ queryKey: ["project-pipelines", projectId] });
      qc.invalidateQueries({ queryKey: ["global-pipelines"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setSearchParams((prev) => {
        const n = new URLSearchParams(prev);
        n.set("tab", "pipelines");
        return n;
      });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64 w-full rounded-xl" />
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

  if (!TABS.some((t) => t.key === active)) {
    return <Navigate to={`/projects/${project.id}?tab=pipelines`} replace />;
  }

  const handleTab = (k: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", k);
    setSearchParams(next);
  };

  const copyRepo = async () => {
    try {
      await navigator.clipboard.writeText(project.repoFullName);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.show("error", "Copie impossible");
    }
  };

  const initials = (project.name ?? "?").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const neutral = "bg-slate-200/70 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300";

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-primary-500/30 bg-primary-600/15 text-lg font-bold text-primary-600 dark:text-primary-400">
              {initials}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold">{project.name}</h1>
              <div className="mt-1 flex items-center gap-1.5">
                <Github className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="truncate font-mono text-sm text-muted">{project.repoFullName}</span>
                <button
                  type="button"
                  onClick={copyRepo}
                  className="rounded p-1 text-muted hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-700"
                  aria-label="Copier le nom du dépôt"
                  title="Copier"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <SimpleBadge className="bg-blue-500/15 text-blue-600 dark:text-blue-400">{project.technology}</SimpleBadge>
                <SimpleBadge className={neutral}>{project.defaultBranch}</SimpleBadge>
                <SimpleBadge
                  className={project.deploymentEnabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : neutral}
                >
                  {project.deploymentEnabled ? "Déploiement actif" : "Déploiement désactivé"}
                </SimpleBadge>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link to={`/projects/${project.id}?tab=config`}>
              <Button variant="outline" className="gap-2">
                <Settings2 className="h-4 w-4" /> Configurer
              </Button>
            </Link>
            <Button
              onClick={() => runMutation.mutate()}
              loading={runMutation.isPending}
              disabled={runMutation.isPending}
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              {runMutation.isPending ? "Lancement…" : "Lancer un pipeline"}
            </Button>
          </div>
        </div>

        <CardContent className="grid grid-cols-2 gap-3 border-t border-border/60 py-4 md:grid-cols-4">
          <Info label="Dépôt" value={project.repoFullName} mono icon={<GitBranch className="h-3.5 w-3.5" />} />
          <Info label="Technologie" value={project.technology} icon={<Shield className="h-3.5 w-3.5" />} />
          <Info label="Branche" value={project.defaultBranch} icon={<GitBranch className="h-3.5 w-3.5" />} />
          <Info label="Pipelines" value={String(project._count?.pipelines ?? 0)} icon={<Rocket className="h-3.5 w-3.5" />} />
        </CardContent>
      </Card>

      <Tabs
        tabs={TABS.map((t) => ({ ...t, badge: t.key === "pipelines" ? project._count?.pipelines : undefined }))}
        active={active}
        onChange={handleTab}
        className="mb-2"
      />

      <div className="min-h-[300px]">
        {active === "overview" && <ProjectOverviewTab project={project} />}
        {active === "pipelines" && <ProjectPipelinesTab projectId={project.id} />}
        {active === "vulnerabilities" && <ProjectVulnerabilitiesTab projectId={project.id} />}
        {active === "resilience" && <ProjectResilienceTab project={project} />}
        {active === "config" && <ProjectConfigTab project={project} />}
      </div>
    </div>
  );
}

function Info({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-100/60 px-3 py-2.5 dark:bg-slate-800/40">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <p className={`truncate text-sm font-medium ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</p>
    </div>
  );
}
