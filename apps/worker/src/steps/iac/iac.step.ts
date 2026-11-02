// apps/worker/src/steps/iac/iac.step.ts
import { ScanOutcome, ScanType } from "@prisma/client";
import {
  AnsibleLintScanner,
  AnsibleSyntaxScanner,
  TrivyScanner,
  type ScanResult,
} from "@devsecops/scanners";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import {
  persistScanFailure,
  persistScanResult,
} from "../../orchestrator/scanner.helper";
import { prisma } from "../../utils/prisma";
import { detectAnsibleProject } from "./ansible-detection";

const trivy = new TrivyScanner();
const ansibleLint = new AnsibleLintScanner();
const ansibleSyntax = new AnsibleSyntaxScanner();

function sumCounts(results: ScanResult[]) {
  return results.reduce(
    (acc, result) => ({
      critical: acc.critical + result.severityCounts.critical,
      high: acc.high + result.severityCounts.high,
      medium: acc.medium + result.severityCounts.medium,
      low: acc.low + result.severityCounts.low,
      info: acc.info + result.severityCounts.info,
    }),
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  );
}

function countFindings(results: ScanResult[]): number {
  return results.reduce((total, result) => total + result.findings.length, 0);
}

async function logResultLogs(
  ctx: StepContext,
  result: ScanResult,
): Promise<void> {
  for (const line of result.logs) {
    const level = line.startsWith("[error]")
      ? "error"
      : line.startsWith("[warn]")
        ? "warn"
        : "info";
    await ctx.log(level, line);
  }
}

/**
 * Scan Infrastructure as Code.
 *
 * `trivy config` couvre Dockerfile, Kubernetes, Terraform, etc. Il ne
 * remplace pas les contrôles propres aux playbooks Ansible : lorsque des
 * playbooks/rôles sont détectés, `ansible-lint` et
 * `ansible-playbook --syntax-check` sont exécutés en plus.
 *
 * Aucun playbook n'est appliqué : `--syntax-check` ne lance aucune tâche.
 */
export async function iacStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const config = await prisma.projectConfiguration.findUnique({
    where: { projectId: ctx.projectId },
    select: {
      iacEnabled: true,
      ansibleLintEnabled: true,
      ansibleSyntaxCheckEnabled: true,
      ansibleTimeoutMs: true,
      ansibleMaxPlaybooks: true,
    },
  });

  const results: ScanResult[] = [];
  const unavailable: string[] = [];
  const hardFailures: string[] = [];
  let ansibleDetected = false;
  let playbookCount = 0;
  let detectionTruncated = false;

  // ------------------------------------------------------------
  // 1. Trivy config (formats réellement supportés par Trivy)
  // ------------------------------------------------------------
  if (config?.iacEnabled !== false) {
    await ctx.log("info", "Vérification de la disponibilité de Trivy (config)...");

    if (!(await trivy.isAvailable())) {
      await ctx.log(
        "warn",
        "Trivy non installé — scan IaC générique ignoré (échec technique signalé au Security Gate)",
      );
      unavailable.push("trivy-config");
      await persistScanFailure(
        {
          pipelineId: ctx.pipelineId,
          projectId: ctx.projectId,
          stepId: ctx.stepId,
          type: ScanType.IAC,
        },
        {
          scanner: "trivy-config",
          outcome: ScanOutcome.SCANNER_UNAVAILABLE,
          reason: "trivy not found",
        },
      );
    } else {
      await ctx.log(
        "info",
        `Analyse IaC générique avec Trivy config${trivy.getVersion() ? ` (${trivy.getVersion()})` : ""}...`,
      );
      const result = await trivy.scanConfig({
        workspaceDir: ctx.workspaceDir,
        onLog: ctx.log,
      });
      await logResultLogs(ctx, result);
      await persistScanResult(
        {
          pipelineId: ctx.pipelineId,
          projectId: ctx.projectId,
          stepId: ctx.stepId,
          type: ScanType.IAC,
        },
        result,
      );
      results.push(result);
      if (result.status === "FAILED") hardFailures.push("trivy-config");
    }
  }

  // ------------------------------------------------------------
  // 2. Détection Ansible (structurelle, pas seulement l'extension)
  // ------------------------------------------------------------
  const ansibleRequested =
    config?.ansibleLintEnabled !== false ||
    config?.ansibleSyntaxCheckEnabled !== false;

  if (ansibleRequested) {
    const detection = await detectAnsibleProject(ctx.workspaceDir);
    ansibleDetected = detection.detected;
    playbookCount = detection.playbooks.length;
    detectionTruncated = detection.truncated;

    if (detection.detected) {
      await ctx.log(
        "info",
        `Ansible détecté : ${detection.playbooks.length} playbook(s), ` +
          `${detection.roleDirs.length} rôle(s), ${detection.inventoryFiles.length} inventaire(s). ` +
          "Analyse statique uniquement, aucune exécution.",
      );
      if (detection.truncated) {
        await ctx.log(
          "warn",
          "Détection Ansible tronquée : limite de fichiers atteinte.",
        );
      }
    } else {
      await ctx.log("info", "Aucun playbook ou rôle Ansible détecté.");
    }

    const maxPlaybooks = Math.max(1, config?.ansibleMaxPlaybooks ?? 20);
    const timeoutMs = Math.max(10_000, config?.ansibleTimeoutMs ?? 300_000);

    // 2a. ansible-lint
    if (
      detection.detected &&
      config?.ansibleLintEnabled !== false
    ) {
      await ctx.log("info", "Vérification de la disponibilité d'ansible-lint...");
      if (!(await ansibleLint.isAvailable())) {
        unavailable.push("ansible-lint");
        await ctx.log(
          "warn",
          "ansible-lint non installé — lint Ansible ignoré (échec technique)",
        );
        await persistScanFailure(
          {
            pipelineId: ctx.pipelineId,
            projectId: ctx.projectId,
            stepId: ctx.stepId,
            type: ScanType.IAC,
          },
          {
            scanner: "ansible-lint",
            outcome: ScanOutcome.SCANNER_UNAVAILABLE,
            reason: "ansible-lint not found",
          },
        );
      } else {
        await ctx.log(
          "info",
          `Lint Ansible avec ${ansibleLint.getVersion() ?? "ansible-lint"}...`,
        );
        const result = await ansibleLint.scan({
          workspaceDir: ctx.workspaceDir,
          playbooks: detection.playbooks,
          maxPlaybooks,
          timeoutMs,
          onLog: ctx.log,
        });
        await logResultLogs(ctx, result);
        await persistScanResult(
          {
            pipelineId: ctx.pipelineId,
            projectId: ctx.projectId,
            stepId: ctx.stepId,
            type: ScanType.IAC,
          },
          result,
        );
        results.push(result);
        if (result.status === "FAILED") hardFailures.push("ansible-lint");
      }
    }

    // 2b. ansible-playbook --syntax-check
    if (
      detection.detected &&
      config?.ansibleSyntaxCheckEnabled !== false
    ) {
      await ctx.log(
        "info",
        "Vérification de la disponibilité d'ansible-playbook...",
      );
      if (!(await ansibleSyntax.isAvailable())) {
        unavailable.push("ansible-syntax-check");
        await ctx.log(
          "warn",
          "ansible-playbook non installé — syntax-check ignoré (échec technique)",
        );
        await persistScanFailure(
          {
            pipelineId: ctx.pipelineId,
            projectId: ctx.projectId,
            stepId: ctx.stepId,
            type: ScanType.IAC,
          },
          {
            scanner: "ansible-syntax-check",
            outcome: ScanOutcome.SCANNER_UNAVAILABLE,
            reason: "ansible-playbook not found",
          },
        );
      } else {
        await ctx.log(
          "info",
          `Syntax-check de ${Math.min(detection.playbooks.length, maxPlaybooks)} playbook(s) ` +
            "(aucune tâche exécutée)...",
        );
        const result = await ansibleSyntax.scan({
          workspaceDir: ctx.workspaceDir,
          playbooks: detection.playbooks,
          maxPlaybooks,
          timeoutMs,
          onLog: ctx.log,
        });
        await logResultLogs(ctx, result);
        await persistScanResult(
          {
            pipelineId: ctx.pipelineId,
            projectId: ctx.projectId,
            stepId: ctx.stepId,
            type: ScanType.IAC,
          },
          result,
        );
        results.push(result);
        if (result.status === "FAILED") hardFailures.push("ansible-syntax-check");
      }
    }
  }

  const counts = sumCounts(results);
  const vulnerabilityCount = countFindings(results);
  const data = {
    scanner: "iac",
    ansibleDetected,
    playbookCount,
    detectionTruncated,
    controlsRun: results.map((result) => result.scanner),
    unavailableControls: unavailable,
    hardFailures,
    vulnerabilityCount,
    severityCounts: counts,
    toolVersions: results
      .filter((result) => result.scannerVersion)
      .map((result) => `${result.scanner}=${result.scannerVersion}`),
  };

  if (hardFailures.length > 0) {
    return {
      success: false,
      exitCode: 1,
      error: `Contrôle(s) IaC en échec : ${hardFailures.join(", ")}`,
      data: {
        ...data,
        outcome: "INTERRUPTED",
        reason: `Contrôle(s) IaC en échec : ${hardFailures.join(", ")}`,
      },
    };
  }

  if (unavailable.length > 0) {
    return {
      success: true,
      exitCode: 0,
      data: {
        ...data,
        skipped: true,
        technical: true,
        outcome: "SCANNER_UNAVAILABLE",
        reason: `Outil(s) indisponible(s) : ${unavailable.join(", ")}`,
      },
    };
  }

  if (results.length === 0) {
    return {
      success: true,
      exitCode: 0,
      data: {
        ...data,
        skipped: true,
        outcome: "NOT_APPLICABLE",
        reason: "Aucun contrôle IaC activé ou applicable",
      },
    };
  }

  return {
    success: true,
    exitCode: 0,
    data: {
      ...data,
      outcome:
        vulnerabilityCount > 0
          ? "SUCCESS_WITH_FINDINGS"
          : "SUCCESS_NO_FINDINGS",
    },
  };
}
