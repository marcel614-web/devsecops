// apps/worker/src/steps/security-scans/sca.step.ts
import path from "node:path";
import fs from "node:fs/promises";
import { ScanType } from "@prisma/client";
import {
  NpmAuditScanner,
  ComposerAuditScanner,
  PipAuditScanner,
  type SecurityScanner,
} from "@devsecops/scanners";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import { persistScanResult } from "../../orchestrator/scanner.helper";

type Tech = "NODEJS" | "PHP" | "PYTHON" | "UNKNOWN";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function detectTech(workspaceDir: string): Promise<Tech> {
  if (await exists(path.join(workspaceDir, "package.json"))) return "NODEJS";
  if (await exists(path.join(workspaceDir, "composer.json"))) return "PHP";
  if (await exists(path.join(workspaceDir, "requirements.txt"))) return "PYTHON";
  if (await exists(path.join(workspaceDir, "pyproject.toml"))) return "PYTHON";
  return "UNKNOWN";
}

function scannerFor(tech: Tech): SecurityScanner | null {
  switch (tech) {
    case "NODEJS":
      return new NpmAuditScanner();
    case "PHP":
      return new ComposerAuditScanner();
    case "PYTHON":
      return new PipAuditScanner();
    default:
      return null;
  }
}

const MISSING_BINARY_LABEL: Record<Tech, string> = {
  NODEJS: "npm",
  PHP: "composer",
  PYTHON: "pip-audit",
  UNKNOWN: "scanner",
};

export async function scaStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const tech = await detectTech(ctx.workspaceDir);
  await ctx.log("info", `SCA : technologie détectée = ${tech}`);

  const scanner = scannerFor(tech);
  if (!scanner) {
    await ctx.log("warn", "Aucun fichier de dépendances reconnu — SCA ignoré");
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "no dependency file" },
    };
  }

  if (!(await scanner.isAvailable(ctx.workspaceDir))) {
    const binary = MISSING_BINARY_LABEL[tech];
    await ctx.log(
      "warn",
      `${binary} non disponible — SCA ${tech} ignoré (échec technique signalé au Security Gate)`,
    );
    return {
      success: true,
      exitCode: 0,
      data: {
        skipped: true,
        technical: true,
        reason: `${binary} not found`,
        technology: tech,
      },
    };
  }

  await ctx.log("info", `Exécution de ${scanner.name}...`);
  const result = await scanner.scan({
    workspaceDir: ctx.workspaceDir,
    onLog: ctx.log,
  });

  for (const line of result.logs) {
    const level = line.startsWith("[error]")
      ? "error"
      : line.startsWith("[warn]")
        ? "warn"
        : "info";
    await ctx.log(level, line);
  }

  await persistScanResult(
    {
      pipelineId: ctx.pipelineId,
      projectId: ctx.projectId,
      stepId: ctx.stepId,
      type: ScanType.SCA,
    },
    result,
  );

  if (result.status === "FAILED") {
    return {
      success: false,
      exitCode: result.exitCode ?? 1,
      error: result.error ?? `${scanner.name} a échoué`,
    };
  }

  await ctx.log(
    "info",
    `${scanner.name} : ${result.vulnerabilityCount} vulnérabilité(s) — ` +
      `critical=${result.severityCounts.critical}, high=${result.severityCounts.high}`,
  );

  return {
    success: true,
    exitCode: 0,
    data: {
      scanner: scanner.name,
      technology: tech,
      vulnerabilityCount: result.vulnerabilityCount,
      severityCounts: result.severityCounts,
    },
  };
}
