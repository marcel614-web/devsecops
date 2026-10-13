// apps/worker/src/orchestrator/pipeline.status.ts
import { PipelineStatus, StepStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";

export async function markPipelineRunning(pipelineId: string): Promise<void> {
  await prisma.pipeline.update({
    where: { id: pipelineId },
    data: {
      status: PipelineStatus.RUNNING,
      startedAt: new Date(),
    },
  });
}

type FinalStatus = "SUCCESS" | "FAILED" | "SECURITY_BLOCKED" | "CANCELLED";

export async function markPipelineFinished(
  pipelineId: string,
  status: FinalStatus,
): Promise<void> {
  const now = new Date();
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    select: { startedAt: true },
  });

  const durationMs = pipeline?.startedAt
    ? now.getTime() - pipeline.startedAt.getTime()
    : null;

  await prisma.pipeline.update({
    where: { id: pipelineId },
    data: {
      status,
      finishedAt: now,
      durationMs,
    },
  });
}

export async function markStepRunning(stepId: string): Promise<void> {
  await prisma.pipelineStep.update({
    where: { id: stepId },
    data: {
      status: StepStatus.RUNNING,
      startedAt: new Date(),
    },
  });
}

export async function markStepFinished(
  stepId: string,
  status: StepStatus,
  options: {
    exitCode?: number | null;
    error?: string | null;
    resultJson?: unknown;
  } = {},
): Promise<void> {
  const now = new Date();
  const step = await prisma.pipelineStep.findUnique({
    where: { id: stepId },
    select: { startedAt: true },
  });

  const durationMs = step?.startedAt
    ? now.getTime() - step.startedAt.getTime()
    : null;

  await prisma.pipelineStep.update({
    where: { id: stepId },
    data: {
      status,
      finishedAt: now,
      durationMs,
      exitCode: options.exitCode ?? null,
      error: options.error ?? null,
      ...(options.resultJson !== undefined
        ? { resultJson: options.resultJson as object }
        : {}),
    },
  });
}