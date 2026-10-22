import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { RefreshCw, XCircle, ExternalLink, GitBranch, GitCommit, User, Clock, Package, ChevronRight, Copy, Check, Timer, PlayCircle, Flag, Download, FileText, GitPullRequest, Boxes, ShieldCheck, Rocket, Globe, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
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
import { useCancelPipeline, usePipelineDetail, usePipelineScans, useRerunPipeline, useResumePipeline } from "@/hooks/usePipeline";
import { pipelineService } from "@/services/pipeline.service";
import { getPipelineFailure } from "@/lib/pipelineFailure";
import { getErrorMessage } from "@/services/api";
import { formatBytes, formatDate, formatDuration, cn } from "@/lib/utils";

export function PipelineDetailPage() {
  const { projectId, pipelineId } = useParams<{ projectId?: string; pipelineId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRerun, setConfirmRerun] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: pipeline, isLoading, isError, error, refetch, isFetching } = usePipelineDetail(projectId, pipelineId);
  const isRunning = pipeline?.status === "QUEUED" || pipeline?.status === "RUNNING";
  const resumeIndex = pipeline?.steps.findIndex((step) => step.status !== "SUCCESS") ?? -1;
  const resumeStep = resumeIndex >= 0 ? pipeline?.steps[resumeIndex] ?? null : null;
  const { data: scans } = usePipelineScans(projectId, pipelineId, !isRunning && !!pipeline);
  const cancelMutation = useCancelPipeline(projectId ?? "", pipelineId ?? "");
  const rerunMutation = useRerunPipeline(projectId ?? "", pipelineId ?? "");
  const resumeMutation = useResumePipeline(projectId ?? "", pipelineId ?? "");

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

  const handleRerun = async () => {
    try {
      const next = await rerunMutation.mutateAsync();
      toast.show("success", `Pipeline relancé : ${next.id.slice(0, 8)}`);
      setConfirmRerun(false);
      navigate(`/projects/${next.projectId}/pipelines/${next.id}`);
    } catch (err) {
      toast.show("error", getErrorMessage(err));
      setConfirmRerun(false);
    }
  };

  const handleResume = async () => {
    try {
      await resumeMutation.mutateAsync();
      toast.show(
        "success",
        resumeStep
          ? `Pipeline repris à l'étape « ${resumeStep.name} »`
          : "Pipeline repris",
      );
      setConfirmResume(false);
      refetch();
    } catch (err) {
      toast.show("error", getErrorMessage(err));
      setConfirmResume(false);
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
  const canRerun =
    pipeline.status === "FAILED" || pipeline.status === "SECURITY_BLOCKED";
  const canResume = !!resumeStep && !isRunning;

  const copySha = async () => {
    try {
      await navigator.clipboard.writeText(pipeline.commitSha);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.show("error", "Copie impossible");
    }
  };

  const downloadReport = async (format: "html" | "pdf") => {
    if (!projectId) return;
    try {
      const blob = await pipelineService.downloadReport(
        projectId,
        pipeline.id,
        format,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rapport-${pipeline.commitSha.slice(0, 8)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.show("error", getErrorMessage(err));
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
          {canResume && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setConfirmResume(true)}
              className="gap-1.5"
              title={
                resumeStep
                  ? `Reprendre à l'étape « ${resumeStep.name} » sans réexécuter les étapes déjà réussies`
                  : "Reprendre le pipeline"
              }
            >
              <PlayCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Reprendre</span>
            </Button>
          )}
          {canRerun && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmRerun(true)}
              className="gap-1.5"
              title="Recréer un pipeline depuis le début avec le même commit et la même branche"
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden md:inline">Tout relancer</span>
            </Button>
          )}
          {!isRunning && pipeline.status !== "QUEUED" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => downloadReport("html")}
                title="Télécharger le rapport HTML"
                className="gap-1.5"
              >
                <FileText className="h-4 w-4" />
                <span className="hidden md:inline">HTML</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => downloadReport("pdf")}
                title="Télécharger le rapport PDF"
                className="gap-1.5"
              >
                <Download className="h-4 w-4" />
                <span className="hidden md:inline">PDF</span>
              </Button>
            </>
          )}
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
          {pipeline.pullRequestNumber && (
            <Info
              icon={GitPullRequest}
              label="Pull request"
              value={`#${pipeline.pullRequestNumber}${
                pipeline.baseBranch ? ` → ${pipeline.baseBranch}` : ""
              }`}
              action={
                pipeline.pullRequestUrl ? (
                  <a
                    href={pipeline.pullRequestUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted hover:text-primary-500"
                    aria-label="Ouvrir la pull request sur GitHub"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : undefined
              }
            />
          )}
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

      {(pipeline.dockerImage || pipeline.sbom || pipeline.deployment) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Boxes className="h-4 w-4" /> Supply chain & déploiement
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Info
              icon={Package}
              label="Image Docker"
              value={
                pipeline.dockerImage
                  ? pipeline.dockerImage.imageTag.split(":").pop() ?? "—"
                  : "—"
              }
              mono
            />
            <Info
              icon={ShieldCheck}
              label="Signature Cosign"
              value={
                pipeline.dockerImage
                  ? pipeline.dockerImage.signed
                    ? "Signée"
                    : "Non signée"
                  : "—"
              }
            />
            <Info
              icon={Boxes}
              label="SBOM (Syft)"
              value={
                pipeline.sbom
                  ? `${pipeline.sbom.packageCount} paquet(s)`
                  : "Non généré"
              }
            />
            <Info
              icon={Rocket}
              label="Déploiement"
              value={pipeline.deployment?.status ?? "—"}
            />

            {pipeline.deployment?.stagingUrl && (
              <Info
                icon={Globe}
                label="Staging"
                value={pipeline.deployment.stagingUrl}
                action={
                  <a
                    href={pipeline.deployment.stagingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted hover:text-primary-500"
                    aria-label="Ouvrir le staging"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                }
              />
            )}
            {pipeline.deployment?.productionUrl && (
              <Info
                icon={Globe}
                label="Production"
                value={pipeline.deployment.productionUrl}
                action={
                  <a
                    href={pipeline.deployment.productionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted hover:text-primary-500"
                    aria-label="Ouvrir la production"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                }
              />
            )}
            {pipeline.deployment?.rollbackImageTag && (
              <Info
                icon={RotateCcw}
                label="Rollback"
                value={pipeline.deployment.rollbackImageTag}
                mono
              />
            )}
          </CardContent>
        </Card>
      )}

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

      <ConfirmDialog
        open={confirmResume}
        title="Reprendre ce pipeline ?"
        description={
          resumeStep
            ? `Le pipeline reprendra à l'étape « ${resumeStep.name} ». Les étapes précédentes déjà réussies seront conservées et ne seront pas réexécutées.`
            : ""
        }
        confirmLabel="Reprendre"
        loading={resumeMutation.isPending}
        onConfirm={handleResume}
        onCancel={() => setConfirmResume(false)}
      />

      <ConfirmDialog
        open={confirmRerun}
        title="Tout relancer ?"
        description={
          pipeline.commitSha.startsWith("manual-")
            ? `Un nouveau pipeline sera créé depuis le début avec le dernier commit de la branche ${pipeline.branch}. L'exécution précédente reste conservée dans l'historique.`
            : `Un nouveau pipeline sera créé depuis le début pour le commit ${pipeline.commitSha.slice(0, 7)} sur la branche ${pipeline.branch}. L'exécution précédente reste conservée dans l'historique.`
        }
        confirmLabel="Tout relancer"
        loading={rerunMutation.isPending}
        onConfirm={handleRerun}
        onCancel={() => setConfirmRerun(false)}
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
