import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { RefreshCw, XCircle, ExternalLink, GitBranch, GitCommit, User, Clock, Package, ChevronRight, Copy, Check, Timer, PlayCircle, Flag } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import { SecurityGatePanel } from "@/components/security/SecurityGatePanel";
import { ScanSummary } from "@/components/security/ScanSummary";
import { PipelineTimeline } from "@/components/security/PipelineTimeline";
import { PipelineLogs } from "@/components/security/PipelineLogs";
import { PipelineFailureBanner } from "@/components/security/PipelineFailureBanner";
import { useCancelPipeline, usePipelineDetail, usePipelineScans } from "@/hooks/usePipeline";
import { getPipelineFailure } from "@/lib/pipelineFailure";
import { getErrorMessage } from "@/services/api";
import { formatBytes, formatDate, formatDuration, cn } from "@/lib/utils";

export function PipelineDetailPage() {
  const { projectId, pipelineId } = useParams<{ projectId?: string; pipelineId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: pipeline, isLoading, isError, error, refetch, isFetching } = usePipelineDetail(projectId, pipelineId);
  const isRunning = pipeline?.status === "QUEUED" || pipeline?.status === "RUNNING";
  const { data: scans } = usePipelineScans(projectId, pipelineId, !isRunning && !!pipeline);
  const cancelMutation = useCancelPipeline(projectId ?? "", pipelineId ?? "");

  useEffect(() => {
    if (!pipeline || selectedStepId) return;
    const running = pipeline.steps.find((s) => s.status === "RUNNING");
    const failed = pipeline.steps.find((s) => s.status === "FAILED" || s.status === "SECURITY_BLOCKED");
    setSelectedStepId(running?.id ?? failed?.id ?? pipeline.steps[0]?.id ?? null);
  }, [pipeline, selectedStepId]);

  useEffect(() => {
    if (!projectId && pipeline) {
      navigate(`/projects/${pipeline.projectId}/pipelines/${pipeline.id}`, { replace: true });
    }
  }, [projectId, pipeline, navigate]);

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync();
      toast.show("success", "Annulation demandée. Le pipeline va s'arrêter.");
      setConfirmCancel(false);
      setTimeout(() => refetch(), 500);
    } catch (err) {
      toast.show("error", getErrorMessage(err));
      setConfirmCancel(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-28 rounded-xl" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !pipeline) {
    return (
      <ErrorState
        title="Pipeline introuvable"
        description={error instanceof Error ? error.message : "Une erreur est survenue."}
        onRetry={() => refetch()}
      />
    );
  }

  const failure = getPipelineFailure(pipeline);

  const copySha = async () => {
    try {
      await navigator.clipboard.writeText(pipeline.commitSha);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.show("error", "Copie impossible");
    }
  };

  return (
    <div className="space-y-4">

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <StatusBadge status={pipeline.status} />
          {isRunning && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> En cours d'exécution
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} title="Rafraîchir" className="gap-1.5">
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            <span className="hidden md:inline">Rafraîchir</span>
          </Button>
          {isRunning && (
            <Button variant="danger" size="sm" onClick={() => setConfirmCancel(true)} className="gap-1.5">
              <XCircle className="h-4 w-4" />
              <span className="hidden md:inline">Annuler</span>
            </Button>
          )}
        </div>
      </div>

      {failure && <PipelineFailureBanner failure={failure} projectId={projectId} />}

      {pipeline.status === "CANCELLED" && (
        <Card className="border-slate-500/40 bg-slate-500/5">
          <CardContent className="py-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Ce pipeline a été <strong>annulé</strong>. Les étapes non démarrées ne seront pas exécutées.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-4 py-4 md:grid-cols-4">
          <Info icon={GitCommit} label="Commit" value={pipeline.commitSha.slice(0, 10)} mono
            action={
              <button type="button" onClick={copySha} aria-label="Copier le SHA complet" className="rounded p-0.5 text-muted hover:text-slate-800 dark:hover:text-slate-100">
                {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              </button>
            } />
          <Info icon={GitBranch} label="Branche" value={pipeline.branch} mono />
          <Info icon={User} label="Auteur" value={pipeline.author.slice(0, 16)} />
          <Info icon={Clock} label="Déclencheur" value={pipeline.trigger} />
          <Info icon={PlayCircle} label="Démarrage" value={pipeline.startedAt ? formatDate(pipeline.startedAt) : "—"} />
          <Info icon={Flag} label="Fin" value={pipeline.finishedAt ? formatDate(pipeline.finishedAt) : "—"} />
          <Info icon={Timer} label="Durée" value={formatDuration(pipeline.durationMs)} />
          {pipeline.dockerImage && (
            <Info icon={Package} label="Image Docker"
              value={`${pipeline.dockerImage.imageTag.split(":").pop()} · ${formatBytes(pipeline.dockerImage.sizeBytes)}`} mono />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SecurityGatePanel gate={pipeline.gateResult} />
        {scans && <ScanSummary scans={scans} />}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PipelineTimeline
          steps={pipeline.steps}
          selectedStepId={selectedStepId}
          onSelectStep={setSelectedStepId}
          blockedReason={pipeline.gateResult?.reason ?? null}
        />
        {projectId ? (
          <PipelineLogs projectId={projectId} pipelineId={pipeline.id} stepId={selectedStepId} isRunning={isRunning} />
        ) : (
          <EmptyState title="Contexte projet manquant" description="Ouvrez ce pipeline depuis la page d'un projet." />
        )}
      </div>

      {!isRunning && pipeline.status !== "CANCELLED" && pipeline.deployment && (
        <div className="flex justify-end">
          <Link to={`/deployments?pipelineId=${pipeline.id}`} className="inline-flex items-center gap-1 text-sm text-primary-500 hover:underline">
            Voir le déploiement <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Annuler ce pipeline ?"
        description="L'exécution sera interrompue et les étapes suivantes ne seront pas lancées. L'étape en cours peut mettre quelques secondes à s'arrêter."
        confirmLabel="Annuler le pipeline"
        danger
        loading={cancelMutation.isPending}
        onConfirm={handleCancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

interface InfoProps {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
  action?: React.ReactNode;
}

function Info({ icon: Icon, label, value, mono, action }: InfoProps) {
  return (
    <div className="min-w-0">
      <p className="mb-1 flex items-center gap-1.5 text-xs text-muted">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
        {action}
      </p>
      <p className={cn("truncate text-sm font-medium", mono && "font-mono text-xs")} title={value}>{value}</p>
    </div>
  );
}
