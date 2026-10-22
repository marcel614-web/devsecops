// apps/worker/src/orchestrator/step.executor.ts
import type { PipelineStep } from "@prisma/client";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkoutStep } from "../steps/checkout/checkout.step";
import { detectionStep } from "../steps/detection/detection.step";
import { installDepsStep } from "../steps/install-deps/install-deps.step";
import { testsStep } from "../steps/tests/tests.step";
import { gitleaksStep } from "../steps/security-scans/gitleaks.step";
import { semgrepStep } from "../steps/security-scans/semgrep.step";
import { scaStep } from "../steps/security-scans/sca.step";
import { iacStep } from "../steps/iac/iac.step";
import { dockerBuildStep } from "../steps/docker-build/docker-build.step";
import { cosignStep } from "../steps/sign/cosign.step";
import { syftStep } from "../steps/sbom/syft.step";
import { trivyStep } from "../steps/image-scan/trivy.step";
import { securityGateStep } from "../steps/security-gate/security-gate.step";
import { deploymentStep } from "../steps/deployment/deployment.step";
import { promotionStep } from "../steps/deployment/promotion.step";
import { zapStep } from "../steps/dynamic-scan/zap.step";
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
   * VÃ©rifie si une demande d'annulation est active pour ce pipeline.
   * Les Ã©tapes longues (build, install) peuvent l'appeler pÃ©riodiquement
   * et abandonner si le retour est `true`.
   */
  isCancelled: () => Promise<boolean>;
  /** Vrai si une Ã©tape critique a Ã©chouÃ© avant l'Ã©tape courante. */
  pipelineAborted?: boolean;
  /** Vrai si le Security Gate a bloquÃ© le pipeline. */
  pipelineSecurityBlocked?: boolean;
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
  INSTALL_DEPS: installDepsStep,
  TESTS: testsStep,
  SECRET_SCAN: gitleaksStep,
  SAST: semgrepStep,
  SCA: scaStep,
  IAC_SCAN: iacStep,
  DOCKER_BUILD: dockerBuildStep,
  SIGN: cosignStep,
  SBOM: syftStep,
  IMAGE_SCAN: trivyStep,
  SECURITY_GATE: securityGateStep,
  DEPLOYMENT: deploymentStep,
  DAST: zapStep,
  PROMOTE: promotionStep,
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
      `Aucun handler enregistrÃ© pour le type "${step.type}" â€” Ã©tape ignorÃ©e`,
    );
    return {
      success: true,
      data: { skipped: true, technical: true, reason: `No handler for type ${step.type}` },
    };
  }

  return handler(step, ctx);
}