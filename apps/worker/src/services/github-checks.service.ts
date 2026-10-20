// apps/worker/src/services/github-checks.service.ts
import { PipelineStatus } from "@prisma/client";
import { logger } from "../utils/logger";
import { getInstallationToken } from "./github-token.service";

export interface PullRequestCheckParams {
  installationId: string;
  repoFullName: string;
  headSha: string;
  pipelineId: string;
  status: PipelineStatus;
  gateStatus?: string | null;
  gateReason?: string | null;
  pullRequestNumber?: number | null;
}

function conclusionFor(status: PipelineStatus): string {
  switch (status) {
    case PipelineStatus.SUCCESS:
      return "success";
    case PipelineStatus.FAILED:
    case PipelineStatus.SECURITY_BLOCKED:
      return "failure";
    case PipelineStatus.CANCELLED:
      return "cancelled";
    default:
      return "neutral";
  }
}

/**
 * Publie un check run GitHub sur le commit de tête d'une pull request.
 *
 * Si la protection de branche exige ce check, un statut `failure`
 * empêche la fusion. C'est le mécanisme de blocage côté GitHub.
 */
export async function postPullRequestCheck(
  params: PullRequestCheckParams,
): Promise<void> {
  try {
    const token = await getInstallationToken(params.installationId);

    const conclusion = conclusionFor(params.status);
    const gateLine = params.gateStatus
      ? `Security Gate : **${params.gateStatus}**${
          params.gateReason ? ` — ${params.gateReason}` : ""
        }`
      : "Security Gate : non évalué";

    const body = {
      name: "DevSecOps Manager / Security Gate",
      head_sha: params.headSha,
      status: "completed",
      conclusion,
      output: {
        title:
          conclusion === "success"
            ? "Pipeline DevSecOps réussi"
            : conclusion === "failure"
              ? "Pipeline DevSecOps échoué"
              : `Pipeline DevSecOps : ${params.status}`,
        summary: [
          `Pipeline : \`${params.pipelineId}\``,
          `Statut : **${params.status}**`,
          gateLine,
          params.pullRequestNumber
            ? `Pull request : #${params.pullRequestNumber}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    };

    const res = await fetch(
      `https://api.github.com/repos/${params.repoFullName}/check-runs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      logger.warn(
        {
          repo: params.repoFullName,
          headSha: params.headSha,
          status: res.status,
          body: text.slice(0, 500),
        },
        "Impossible de publier le check run GitHub",
      );
      return;
    }

    logger.info(
      {
        repo: params.repoFullName,
        headSha: params.headSha,
        conclusion,
      },
      "Check run GitHub publié",
    );
  } catch (err) {
    logger.warn(
      { err, repo: params.repoFullName },
      "Erreur lors de la publication du check run GitHub",
    );
  }
}
