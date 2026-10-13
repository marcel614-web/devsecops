// apps/worker/src/steps/security-scans/sca.step.ts
import path from "node:path";
import fs from "node:fs/promises";
import { ScanType } from "@prisma/client";
import { NpmAuditScanner } from "@devsecops/scanners";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import { persistScanResult } from "../../orchestrator/scanner.helper";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function detectTech(workspaceDir: string): Promise<"NODEJS" | "PHP" | "PYTHON" | "UNKNOWN"> {
  if (await exists(path.join(workspaceDir, "package.json"))) return "NODEJS";
  if (await exists(path.join(workspaceDir, "composer.json"))) return "PHP";
  if (await exists(path.join(workspaceDir, "requirements.txt"))) return "PYTHON";
  if (await exists(path.join(workspaceDir, "pyproject.toml"))) return "PYTHON";
  return "UNKNOWN";
}

export async function scaStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const tech = await detectTech(ctx.workspaceDir);
  await ctx.log("info", `SCA : technologie détectée = ${tech}`);

  if (tech === "UNKNOWN") {
    await ctx.log("warn", "Aucun fichier de dépendances reconnu — SCA ignoré");
    return { success: true, exitCode: 0, data: { skipped: true } };
  }

  if (tech === "NODEJS") {
    const scanner = new NpmAuditScanner();
    if (!(await scanner.isAvailable())) {
      await ctx.log("warn", "npm non disponible — SCA Node.js ignoré");
      return { success: true, exitCode: 0, data: { skipped: true } };
    }

    await ctx.log("info", "Exécution de npm audit...");
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
        error: result.error ?? "npm audit a échoué",
      };
    }

    await ctx.log(
      "info",
      `npm audit : ${result.vulnerabilityCount} vulnérabilité(s) — ` +
        `critical=${result.severityCounts.critical}, high=${result.severityCounts.high}`,
    );

    return {
      success: true,
      exitCode: 0,
      data: {
        scanner: "npm-audit",
        vulnerabilityCount: result.vulnerabilityCount,
        severityCounts: result.severityCounts,
      },
    };
  }

  if (tech === "PHP") {
    await ctx.log("warn", "SCA PHP (composer audit) pas encore implémenté — étape ignorée");
    return { success: true, exitCode: 0, data: { skipped: true, reason: "php sca TODO" } };
  }

  if (tech === "PYTHON") {
    await ctx.log("warn", "SCA Python (pip-audit) pas encore implémenté — étape ignorée");
    return { success: true, exitCode: 0, data: { skipped: true, reason: "python sca TODO" } };
  }

  return { success: true, exitCode: 0, data: { skipped: true } };
}