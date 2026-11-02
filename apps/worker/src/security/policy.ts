// apps/worker/src/security/policy.ts
import type { Prisma } from "@prisma/client";
import {
  buildSecurityPolicy,
  hashSecurityPolicy,
  type SecurityPolicyV1,
} from "@devsecops/shared";
import { prisma } from "../utils/prisma";

export interface LoadedSecurityPolicy {
  policy: SecurityPolicyV1;
  policyHash: string;
  snapshotId: string;
  createdFromCurrentConfig: boolean;
}

function asPolicy(value: Prisma.JsonValue): SecurityPolicyV1 {
  return value as unknown as SecurityPolicyV1;
}

/**
 * Charge l'instantané de politique du pipeline.
 *
 * Les anciens pipelines créés avant l'introduction des instantanés n'en ont
 * pas. Dans ce cas uniquement, un instantané est créé à partir de la config
 * actuelle : on ne modifie jamais un instantané existant et on ne recalcule
 * pas les décisions déjà persistées.
 */
export async function loadPipelineSecurityPolicy(
  pipelineId: string,
  projectId: string,
  log?: (level: "info" | "warn" | "error", message: string) => Promise<void>,
): Promise<LoadedSecurityPolicy> {
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    select: {
      securityPolicy: true,
      gateResult: { select: { id: true } },
      project: { select: { config: true } },
    },
  });
  if (!pipeline) throw new Error("Pipeline introuvable");

  if (!pipeline.securityPolicy && pipeline.gateResult) {
    // Ne jamais rejouer une décision de sécurité déjà persistée avec la
    // configuration actuelle : sans instantané, la politique réellement
    // utilisée est inconnue. L'utilisateur doit relancer un nouveau pipeline.
    throw new Error(
      "Ce pipeline historique possède déjà une décision de sécurité mais aucun instantané de politique : " +
        "elle ne peut pas être recalculée avec la configuration actuelle. Relancez un nouveau pipeline.",
    );
  }

  if (pipeline.securityPolicy) {
    const policy = asPolicy(pipeline.securityPolicy.policyJson);
    return {
      policy,
      policyHash: pipeline.securityPolicy.policyHash,
      snapshotId: pipeline.securityPolicy.id,
      createdFromCurrentConfig: false,
    };
  }

  if (!pipeline.project.config) {
    throw new Error("Configuration du projet introuvable");
  }

  const policy = buildSecurityPolicy(pipeline.project.config);
  const policyHash = hashSecurityPolicy(policy);

  try {
    const created = await prisma.pipelineSecurityPolicy.create({
      data: {
        pipelineId,
        projectId,
        version: policy.version,
        policyHash,
        policyJson: policy as unknown as Prisma.InputJsonValue,
      },
    });
    await log?.(
      "warn",
      "Aucun instantané de politique pour ce pipeline historique — instantané créé avant évaluation",
    );
    return {
      policy,
      policyHash,
      snapshotId: created.id,
      createdFromCurrentConfig: true,
    };
  } catch {
    // Course possible avec une reprise concurrente : relit l'instantané
    // gagnant au lieu de recalculer.
    const existing = await prisma.pipelineSecurityPolicy.findUnique({
      where: { pipelineId },
    });
    if (!existing) throw new Error("Impossible de figer la politique du pipeline");
    return {
      policy: asPolicy(existing.policyJson),
      policyHash: existing.policyHash,
      snapshotId: existing.id,
      createdFromCurrentConfig: false,
    };
  }
}
