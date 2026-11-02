import { useState } from "react";
import { CheckCircle2, Clock, GitCommitHorizontal, ShieldCheck, XCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/feedback/Toast";
import { deploymentService } from "@/services/deployment.service";
import { getErrorMessage } from "@/services/api";
import { timeAgo } from "@/lib/utils";
import type { DeploymentApproval } from "@/types/api";

type Decision =
  | { kind: "APPROVE"; approval: DeploymentApproval }
  | { kind: "REJECT"; approval: DeploymentApproval };

export function DeploymentApprovalsPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [comment, setComment] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["deployment-approvals", "PENDING"],
    queryFn: () => deploymentService.listApprovals({ status: "PENDING" }),
    refetchInterval: 15_000,
  });

  const decideMutation = useMutation({
    mutationFn: (input: {
      id: string;
      decision: "APPROVE" | "REJECT";
      comment?: string;
    }) =>
      deploymentService.decideApproval(input.id, {
        decision: input.decision,
        comment: input.comment,
      }),
    onSuccess: (approval) => {
      toast.show(
        "success",
        approval.status === "APPROVED"
          ? "Promotion approuvée — le pipeline reprend"
          : "Promotion refusée — le pipeline est arrêté",
      );
      setDecision(null);
      setComment("");
      qc.invalidateQueries({ queryKey: ["deployment-approvals"] });
      qc.invalidateQueries({ queryKey: ["deployments"] });
      qc.invalidateQueries({ queryKey: ["pipelines"] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const items = data?.items ?? [];

  if (isLoading) {
    return <Skeleton className="h-24 rounded-xl" />;
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
        Impossible de charger les approbations : {getErrorMessage(error)}
      </div>
    );
  }

  if (items.length === 0) return null;

  const handleConfirm = () => {
    if (!decision) return;
    if (decision.kind === "REJECT" && !comment.trim()) return;
    decideMutation.mutate({
      id: decision.approval.id,
      decision: decision.kind,
      comment: comment.trim() || undefined,
    });
  };

  return (
    <>
      <Card className="border-sky-500/30">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <ShieldCheck className="h-4 w-4 text-sky-500" />
          <h2 className="text-sm font-medium">Approbations de production en attente</h2>
          <span className="ml-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400">
            {items.length}
          </span>
        </div>
        <CardContent className="space-y-3 py-4">
          {items.map((approval) => (
            <div
              key={approval.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-3 md:flex-row md:items-center"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">
                    {approval.project?.name ?? approval.projectId}
                  </p>
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-muted dark:bg-slate-700">
                    {approval.environment}
                  </span>
                  {approval.pipeline?.pullRequestNumber && (
                    <span className="text-xs text-muted">
                      PR #{approval.pipeline.pullRequestNumber}
                    </span>
                  )}
                </div>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span className="inline-flex items-center gap-1">
                    <GitCommitHorizontal className="h-3.5 w-3.5" />
                    <span className="font-mono">{approval.commitSha.slice(0, 12)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    demandée {timeAgo(approval.requestedAt)}
                  </span>
                  {approval.expiresAt && (
                    <span>expire {timeAgo(approval.expiresAt)}</span>
                  )}
                </p>
                <p className="truncate font-mono text-[11px] text-muted">
                  {approval.imageTag}
                  <br />
                  <span title={approval.imageDigest}>
                    digest {approval.imageDigest.slice(0, 23)}…
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setComment("");
                    setDecision({ kind: "APPROVE", approval });
                  }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approuver
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-1.5"
                  onClick={() => {
                    setComment("");
                    setDecision({ kind: "REJECT", approval });
                  }}
                >
                  <XCircle className="h-3.5 w-3.5" /> Refuser
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {decision && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setDecision(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="approval-dialog-title"
            className="w-full max-w-lg rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border px-6 py-4">
              <h2 id="approval-dialog-title" className="text-lg font-semibold">
                {decision.kind === "APPROVE"
                  ? "Approuver la promotion"
                  : "Refuser la promotion"}
              </h2>
              <p className="mt-1 text-xs text-muted">
                La décision est liée à ce commit et à ce digest ; elle ne pourra
                pas être réutilisée pour un autre artefact.
              </p>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
                <p className="text-sm font-medium">
                  {decision.approval.project?.name ?? decision.approval.projectId}
                </p>
                <p className="mt-1 font-mono text-xs text-muted">
                  commit {decision.approval.commitSha}
                </p>
                <p className="font-mono text-xs text-muted">
                  digest {decision.approval.imageDigest}
                </p>
              </div>

              <div>
                <label
                  htmlFor="approval-comment"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Commentaire {decision.kind === "REJECT" ? "*" : "(optionnel)"}
                </label>
                <textarea
                  id="approval-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder={
                    decision.kind === "REJECT"
                      ? "Motif du refus (obligatoire)"
                      : "Contexte de la décision (optionnel)"
                  }
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
              </div>

              {decision.kind === "REJECT" && !comment.trim() && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Un motif est requis pour refuser la promotion.
                </p>
              )}

              {decideMutation.isError && (
                <div
                  role="alert"
                  className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-500"
                >
                  {getErrorMessage(decideMutation.error)}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button variant="secondary" onClick={() => setDecision(null)}>
                  Annuler
                </Button>
                <Button
                  onClick={handleConfirm}
                  loading={decideMutation.isPending}
                  disabled={decision.kind === "REJECT" && !comment.trim()}
                  className={
                    decision.kind === "REJECT"
                      ? "bg-red-600 hover:bg-red-700"
                      : undefined
                  }
                >
                  {decision.kind === "APPROVE" ? "Approuver" : "Refuser"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
