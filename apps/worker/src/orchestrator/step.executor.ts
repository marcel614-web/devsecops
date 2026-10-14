// apps/worker/src/orchestrator/step.executor.ts
import type { PipelineStep } from "@prisma/client";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkoutStep } from "../steps/checkout/checkout.step";
import { detectionStep } from "../steps/detection/detection.step";
import { testsStep } from "../steps/tests/tests.step";
import { gitleaksStep } from "../steps/security-scans/gitleaks.step";
import { semgrepStep } from "../steps/security-scans/semgrep.step";
import { scaStep } from "../steps/security-scans/sca.step";
import { dockerBuildStep } from "../steps/docker-build/docker-build.step";
import { trivyStep } from "../steps/image-scan/trivy.step";
import { securityGateStep } from "../steps/security-gate/security-gate.step";
import { deploymentStep } from "../steps/deployment/deployment.step";
import { finalReportStep } from "../steps/report/final-report.step";

export const execFileAsync = promisify(execFile);

export interface StepContext {
  pipelineId: string;
  projectId: string;
  stepId: string;
  workspaceDir: string;
  repoFullName: string;
  commitSha: string;
  branch: string;
  log: (
    level: "info" | "warn" | "error" | "debug",
    message: string,
  ) => Promise<void>;
  /**
   * Vérifie si une demande d'annulation est active pour ce pipeline.
   * Les étapes longues (build, install) peuvent l'appeler périodiquement
   * et abandonner si le retour est `true`.
   */
  isCancelled: () => Promise<boolean>;
}

export interface StepResult {
  success: boolean;
  exitCode?: number;
  error?: string;
  data?: Record<string, unknown>;
  blockDeployment?: boolean;
}

export type StepHandler = (
  step: PipelineStep,
  ctx: StepContext,
) => Promise<StepResult>;

const HANDLERS: Record<string, StepHandler> = {
  CHECKOUT: checkoutStep,
  DETECTION: detectionStep,
  TESTS: testsStep,
  SECRET_SCAN: gitleaksStep,
  SAST: semgrepStep,
  SCA: scaStep,
  DOCKER_BUILD: dockerBuildStep,
  IMAGE_SCAN: trivyStep,
  SECURITY_GATE: securityGateStep,
  DEPLOYMENT: deploymentStep,
  REPORT: finalReportStep,
};

export async function executeStep(
  step: PipelineStep,
  ctx: StepContext,
): Promise<StepResult> {
  const handler = HANDLERS[step.type];

  if (!handler) {
    await ctx.log(
      "warn",
      `Aucun handler enregistré pour le type "${step.type}" — étape ignorée`,
    );
    return {
      success: true,
      data: { skipped: true, reason: `No handler for type ${step.type}` },
    };
  }

  return handler(step, ctx);
}