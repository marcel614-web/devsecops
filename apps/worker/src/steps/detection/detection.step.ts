// apps/worker/src/steps/detection/detection.step.ts
import path from "node:path";
import fs from "node:fs/promises";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

type Technology = "NODEJS" | "PHP" | "PYTHON" | "UNKNOWN";

interface Detection {
  technology: Technology;
  evidence: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function detect(workspaceDir: string): Promise<Detection> {
  const checks: Array<{ file: string; tech: Technology }> = [
    { file: "package.json", tech: "NODEJS" },
    { file: "composer.json", tech: "PHP" },
    { file: "requirements.txt", tech: "PYTHON" },
    { file: "pyproject.toml", tech: "PYTHON" },
  ];

  for (const c of checks) {
    if (await exists(path.join(workspaceDir, c.file))) {
      return { technology: c.tech, evidence: c.file };
    }
  }
  return { technology: "UNKNOWN", evidence: "(aucun marqueur détecté)" };
}

export async function detectionStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", "Analyse des fichiers du repository...");

  const result = await detect(ctx.workspaceDir);

  if (result.technology === "UNKNOWN") {
    await ctx.log("warn", "Technologie inconnue — étape non bloquante");
    return {
      success: true,
      exitCode: 0,
      data: { technology: "UNKNOWN", evidence: result.evidence },
    };
  }

  await ctx.log(
    "info",
    `Technologie détectée : ${result.technology} (via ${result.evidence})`,
  );

  return {
    success: true,
    exitCode: 0,
    data: { technology: result.technology, evidence: result.evidence },
  };
}