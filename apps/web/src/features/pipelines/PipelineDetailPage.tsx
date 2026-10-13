// apps/web/src/features/pipelines/PipelineDetailPage.tsx
import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCw,
  XCircle,
  ExternalLink,
  GitBranch,
  GitCommit,
  User,
  Clock,
  Package,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import {
  useCancelPipeline,
  usePipelineDetail,
  usePipelineScans,
} from "@/hooks/usePipeline";
import { getErrorMessage } from "@/services/api";
import {
  formatBytes,
  formatDate,
  formatDuration,
} from "@/lib/utils";

function SecurityGatePanel({ gate }: { gate?: any }) {
  return (
    <Card className="h-full border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30">
      <CardContent className="py-4">
        <p className="text-sm font-medium mb-2">Gate de sécurité</p>
        <p className="text-sm text-muted">
          {gate?.status ?? "INCONNU"}
        </p>
        {gate?.reason && (
          <p className="text-xs text-muted mt-2">{gate.reason}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ScanSummary({ scans }: { scans?: any[] }) {
  if (!scans || scans.length === 0) {
    return (
      <Card className="h-full border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30">
        <CardContent className="py-4">
          <p className="text-sm font-medium">Résumé des scans</p>
          <p className="text-sm text-muted mt-2">Aucun scan disponible.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30">
      <CardContent className="py-4">
        <p className="text-sm font-medium mb-2">Résumé des scans</p>
        <div className="space-y-2">
          {scans.map((scan, index) => (
            <div key={scan?.id ?? index} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted">{scan?.name ?? "Scan"}</span>
              <StatusBadge status={scan?.status ?? "UNKNOWN"} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineTimeline({
  steps,
  selectedStepId,
  onSelectStep,
  blockedReason,
}: {
  steps?: any[];
  selectedStepId?: string | null;
  onSelectStep?: (id: string) => void;
  blockedReason?: string | null;
}) {
  return (
    <Card className="h-full border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30">
      <CardContent className="py-4">
        <p className="text-sm font-medium mb-2">Étapes du pipeline</p>
        {blockedReason && (
          <p className="text-xs text-muted mb-3">Bloqué: {blockedReason}</p>
        )}
        <div className="space-y-2">
          {(steps ?? []).map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => onSelectStep?.(step.id)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                selectedStepId === step.id
                  ? "border-primary-500 bg-primary-50 dark:bg-primary-950/30"
                  : "border-slate-200 dark:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span>{step.name}</span>
                <StatusBadge status={step.status} />
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineLogs({
  projectId,
  pipelineId,
  stepId,
  isRunning,
}: {
  projectId?: string;
  pipelineId?: string;
  stepId?: string | null;
  isRunning?: boolean;
}) {
  return (
    <Card className="h-full border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30">
      <CardContent className="py-4">
        <p className="text-sm font-medium mb-2">Logs</p>
        <p className="text-sm text-muted">
          {stepId ? `Étape: ${stepId}` : "Aucune étape sélectionnée."}
        </p>
        <p className="text-xs text-muted mt-2">
          {projectId && pipelineId
            ? `projectId=${projectId} / pipelineId=${pipelineId}`
            : "Projet ou pipeline non défini."}
        </p>
        {isRunning && <p className="text-xs text-muted mt-2">Pipeline en cours d'exécution.</p>}
      </CardContent>
    </Card>
  );
}

export function PipelineDetailPage() {
  const { projectId, pipelineId } = useParams<{
    projectId?: string;
    pipelineId: string;
  }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const {
    data: pipeline,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = usePipelineDetail(projectId, pipelineId);

  const isRunning =
    pipeline?.status === "QUEUED" || pipeline?.status === "RUNNING";

  const { data: scans } = usePipelineScans(
    projectId,
    pipelineId,
    !isRunning && !!pipeline,
  );

  const cancelMutation = useCancelPipeline(
    projectId ?? "",
    pipelineId ?? "",
  );

  // Sélectionne automatiquement la première étape pertinente.
  useEffect(() => {
    if (!pipeline || selectedStepId) return;
    const running = pipeline.steps.find((s) => s.status === "RUNNING");
    const failed = pipeline.steps.find(
      (s) => s.status === "FAILED" || s.status === "SECURITY_BLOCKED",
    );
    const first = pipeline.steps[0];
    setSelectedStepId(running?.id ?? failed?.id ?? first?.id ?? null);
  }, [pipeline, selectedStepId]);

  // Redirection si pas de projectId (cas d'accès direct via /pipelines/:id)
  useEffect(() => {
    if (!projectId && pipeline) {
      navigate(`/projects/${pipeline.projectId}/pipelines/${pipeline.id}`, {
        replace: true,
      });
    }
  }, [projectId, pipeline, navigate]);

  const handleSelectStep = (id: string) => setSelectedStepId(id);

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync();
      toast.show(
        "success",
        "Demande d'annulation envoyée. Le pipeline va s'arrêter.",
      );
      setConfirmCancel(false);
      // Le polling détectera le changement de statut, mais on force
      // aussi un refetch immédiat pour un retour visuel rapide.
      setTimeout(() => refetch(), 500);
    } catch (err) {
      toast.show("error", getErrorMessage(err));
      setConfirmCancel(false);
    }
  };

  // ------------------------------------------------------------
  // État de chargement
  // ------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-32" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------
  // Erreur
  // ------------------------------------------------------------
  if (isError || !pipeline) {
    return (
      <ErrorState
        title="Pipeline introuvable"
        description={
          error instanceof Error ? error.message : "Une erreur est survenue."
        }
        onRetry={() => refetch()}
      />
    );
  }

  const canCancel =
    pipeline.status === "QUEUED" || pipeline.status === "RUNNING";

  // ------------------------------------------------------------
  // Rendu principal
  // ------------------------------------------------------------
  return (
    <div>
      {/* En-tête : retour + titre + statut + actions */}
      <div className="flex items-center gap-3 mb-4">
        {projectId && (
          <Link
            to={`/projects/${projectId}?tab=pipelines`}
            className="text-muted hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
            title="Retour au projet"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate flex items-center gap-3 flex-wrap">
            <span>Pipeline</span>
            <span className="font-mono text-muted text-lg">
              #{pipeline.id.slice(0, 8)}
            </span>
            <StatusBadge status={pipeline.status} />
          </h1>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Rafraîchir"
          >
            <RefreshCw
              className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
            />
            <span className="hidden md:inline">Rafraîchir</span>
          </Button>
          {canCancel && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmCancel(true)}
              title="Annuler le pipeline"
            >
              <XCircle className="w-4 h-4" />
              <span className="hidden md:inline">Annuler</span>
            </Button>
          )}
        </div>
      </div>

      {/* Bandeau d'annulation en cours (feedback visuel) */}
      {pipeline.status === "CANCELLED" && (
        <Card className="mb-4 border-slate-500/40 bg-slate-500/5">
          <CardContent className="py-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Ce pipeline a été <strong>annulé</strong>. Les étapes qui
              n'avaient pas encore démarré ne seront pas exécutées.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Informations d'exécution */}
      <Card className="mb-4">
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
          <Info
            icon={GitCommit}
            label="Commit"
            value={pipeline.commitSha.slice(0, 10)}
            mono
          />
          <Info
            icon={GitBranch}
            label="Branche"
            value={pipeline.branch}
            mono
          />
          <Info
            icon={User}
            label="Auteur"
            value={pipeline.author.slice(0, 12)}
          />
          <Info icon={Clock} label="Trigger" value={pipeline.trigger} />
          <Info
            label="Démarrage"
            value={pipeline.startedAt ? formatDate(pipeline.startedAt) : "—"}
          />
          <Info
            label="Fin"
            value={pipeline.finishedAt ? formatDate(pipeline.finishedAt) : "—"}
          />
          <Info label="Durée" value={formatDuration(pipeline.durationMs)} />
          {pipeline.dockerImage && (
            <Info
              icon={Package}
              label="Image Docker"
              value={`${pipeline.dockerImage.imageTag.split(":").pop()} (${
                formatBytes(pipeline.dockerImage.sizeBytes)
              })`}
              mono
            />
          )}
        </CardContent>
      </Card>

      {/* Security Gate + résumé des scans */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <SecurityGatePanel gate={pipeline.gateResult} />
        {scans && <ScanSummary scans={scans} />}
      </div>

      {/* Timeline + Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PipelineTimeline
          steps={pipeline.steps}
          selectedStepId={selectedStepId}
          onSelectStep={handleSelectStep}
          blockedReason={pipeline.gateResult?.reason ?? null}
        />

        {projectId ? (
          <PipelineLogs
            projectId={projectId}
            pipelineId={pipeline.id}
            stepId={selectedStepId}
            isRunning={isRunning}
          />
        ) : (
          <EmptyState
            title="Contexte projet manquant"
            description="Ouvre ce pipeline depuis la page d'un projet."
          />
        )}
      </div>

      {/* Actions secondaires */}
      {!isRunning &&
        pipeline.status !== "CANCELLED" &&
        pipeline.deployment && (
          <div className="mt-6 flex justify-end">
            <Link
              to={`/deployments?pipelineId=${pipeline.id}`}
              className="text-sm text-primary-500 hover:underline inline-flex items-center gap-1"
            >
              Voir le déploiement <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

      {/* Modale de confirmation d'annulation */}
      <ConfirmDialog
        open={confirmCancel}
        title="Annuler ce pipeline ?"
        description="L'exécution en cours sera interrompue. Les étapes suivantes ne seront pas lancées. L'étape actuellement en cours peut prendre quelques secondes pour se terminer proprement."
        confirmLabel="Annuler le pipeline"
        danger
        loading={cancelMutation.isPending}
        onConfirm={handleCancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

// ------------------------------------------------------------
// Petit composant d'affichage clé/valeur
// ------------------------------------------------------------
interface InfoProps {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}

function Info({ icon: Icon, label, value, mono }: InfoProps) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted mb-0.5 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </p>
      <p className={`text-sm truncate ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </p>
    </div>
  );
}