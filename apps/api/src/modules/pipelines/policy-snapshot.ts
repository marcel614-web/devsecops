// apps/api/src/modules/pipelines/policy-snapshot.ts
import type { Prisma, ProjectConfiguration } from "@prisma/client";
import {
  buildSecurityPolicy,
  hashSecurityPolicy,
} from "@devsecops/shared";

/**
 * Fige la politique de sécurité effective d'un pipeline dans la même
 * transaction que sa création. Le worker ne relit jamais la configuration
 * courante pour une exécution déjà démarrée.
 */
export async function createPipelineSecurityPolicy(
  tx: Prisma.TransactionClient,
  params: {
    pipelineId: string;
    projectId: string;
    config: ProjectConfiguration;
  },
): Promise<void> {
  const policy = buildSecurityPolicy(params.config);

  await tx.pipelineSecurityPolicy.create({
    data: {
      pipelineId: params.pipelineId,
      projectId: params.projectId,
      version: policy.version,
      policyHash: hashSecurityPolicy(policy),
      policyJson: policy as unknown as Prisma.InputJsonValue,
    },
  });
}
