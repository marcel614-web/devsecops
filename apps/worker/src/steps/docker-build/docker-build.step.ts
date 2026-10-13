// apps/worker/src/steps/docker-build/docker-build.step.ts
import path from "node:path";
import fs from "node:fs/promises";
import { execFileAsync } from "../../orchestrator/step.executor";
import { prisma } from "../../utils/prisma";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Génère un Dockerfile basique selon la techno détectée.
 * Ce Dockerfile est utilisé uniquement si le repo n'en fournit pas.
 */
function generateDockerfile(tech: "NODEJS" | "PHP" | "PYTHON" | "UNKNOWN"): string {
  if (tech === "NODEJS") {
    return [
      "FROM node:22-alpine",
      "WORKDIR /app",
      "COPY package*.json ./",
      "RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund",
      "COPY . .",
      "RUN rm -f .devsecops.Dockerfile",
      "EXPOSE 3000",
      'CMD ["node", "index.js"]',
    ].join("\n");
  }
  if (tech === "PHP") {
    return [
      "FROM php:8.3-cli",
      "WORKDIR /app",
      "COPY . .",
      "RUN rm -f .devsecops.Dockerfile",
      "EXPOSE 8000",
      'CMD ["php", "-S", "0.0.0.0:8000"]',
    ].join("\n");
  }
  if (tech === "PYTHON") {
    return [
      "FROM python:3.12-slim",
      "WORKDIR /app",
      "COPY requirements.txt* pyproject.toml* ./",
      "RUN (test -f requirements.txt && pip install --no-cache-dir -r requirements.txt) || (test -f pyproject.toml && pip install --no-cache-dir .) || true",
      "COPY . .",
      "RUN rm -f .devsecops.Dockerfile",
      "EXPOSE 8000",
      'CMD ["python", "-m", "http.server", "8000"]',
    ].join("\n");
  }
  // Fallback générique
  return [
    "FROM alpine:latest",
    "WORKDIR /app",
    "COPY . .",
    "RUN rm -f .devsecops.Dockerfile",
    'CMD ["sleep", "3600"]',
  ].join("\n");
}

async function detectTech(workspaceDir: string): Promise<"NODEJS" | "PHP" | "PYTHON" | "UNKNOWN"> {
  if (await exists(path.join(workspaceDir, "package.json"))) return "NODEJS";
  if (await exists(path.join(workspaceDir, "composer.json"))) return "PHP";
  if (await exists(path.join(workspaceDir, "requirements.txt"))) return "PYTHON";
  if (await exists(path.join(workspaceDir, "pyproject.toml"))) return "PYTHON";
  return "UNKNOWN";
}

export async function dockerBuildStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const imageTag = `devsecops/${ctx.projectId}:${ctx.commitSha.slice(0, 12)}`;

  // 1. Cherche un Dockerfile fourni par le repo.
  let dockerfilePath = path.join(ctx.workspaceDir, "Dockerfile");
  let generated = false;

  if (!(await exists(dockerfilePath))) {
    await ctx.log("warn", "Aucun Dockerfile fourni — génération automatique");

    const tech = await detectTech(ctx.workspaceDir);
    await ctx.log("info", `Technologie détectée pour le Dockerfile : ${tech}`);

    const content = generateDockerfile(tech);
    dockerfilePath = path.join(ctx.workspaceDir, ".devsecops.Dockerfile");
    await fs.writeFile(dockerfilePath, content, "utf8");
    generated = true;
  } else {
    await ctx.log("info", "Dockerfile trouvé dans le repository");
  }

  const dockerfileArg = generated ? ".devsecops.Dockerfile" : "Dockerfile";

  // 2. Build.
  await ctx.log("info", `Build de l'image ${imageTag}...`);
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      [
        "build",
        "-f", dockerfileArg,
        "-t", imageTag,
        "--label", `devsecops.pipeline=${ctx.pipelineId}`,
        "--label", `devsecops.project=${ctx.projectId}`,
        ".",
      ],
      {
        cwd: ctx.workspaceDir,
        timeout: 30 * 60_000,
        maxBuffer: 100 * 1024 * 1024,
        shell: true,
      },
    );
    const duration = Date.now() - started;
    const tail = (stdout || "").trim().split("\n").slice(-3).join("\n");
    if (tail) await ctx.log("info", tail);
    if (stderr && stderr.trim()) {
      await ctx.log("debug", stderr.trim().slice(-2000));
    }
    await ctx.log("info", `Build réussi en ${(duration / 1000).toFixed(1)}s`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const anyErr = err as { stdout?: string; stderr?: string };
    if (anyErr.stdout) {
      await ctx.log("error", anyErr.stdout.trim().slice(-3000));
    }
    if (anyErr.stderr) {
      await ctx.log("error", anyErr.stderr.trim().slice(-3000));
    }
    await ctx.log("error", `Échec du build Docker : ${msg}`);
    return { success: false, exitCode: 1, error: msg };
  } finally {
    // Nettoie le Dockerfile généré (n'est pas nécessaire dans le workspace après le build).
    if (generated) {
      await fs.rm(dockerfilePath, { force: true }).catch(() => undefined);
    }
  }

  // 3. Inspecte l'image (id + taille).
  let imageId: string | null = null;
  let sizeBytes: bigint | null = null;
  try {
    const { stdout: idOut } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{.Id}}", imageTag],
      { timeout: 30_000, shell: true },
    );
    imageId = idOut.trim();

    const { stdout: sizeOut } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{.Size}}", imageTag],
      { timeout: 30_000, shell: true },
    );
    const parsedSize = Number.parseInt(sizeOut.trim(), 10);
    if (!Number.isNaN(parsedSize)) {
      sizeBytes = BigInt(parsedSize);
    }
  } catch (err) {
    await ctx.log("warn", `Impossible d'inspecter l'image : ${String(err)}`);
  }

  // 4. Persiste dans DockerImage.
  await prisma.dockerImage.upsert({
    where: { pipelineId: ctx.pipelineId },
    create: {
      pipelineId: ctx.pipelineId,
      imageTag,
      imageId,
      sizeBytes,
    },
    update: {
      imageTag,
      imageId,
      sizeBytes,
    },
  });

  await ctx.log(
    "info",
    `Image : ${imageTag}${sizeBytes ? ` (${(Number(sizeBytes) / 1024 / 1024).toFixed(1)} MB)` : ""}`,
  );

  return {
    success: true,
    exitCode: 0,
    data: {
      imageTag,
      imageId,
      sizeBytes: sizeBytes ? Number(sizeBytes) : null,
    },
  };
}