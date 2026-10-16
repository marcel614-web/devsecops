// apps/api/src/modules/pipelines/pipelines.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as pipelinesService from "./pipelines.service";
import type {
  PipelineListQuery,
  PipelineLogsQuery,
  PipelineScansQuery,
  RunPipelineInput,
} from "./pipelines.schema";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

// ============================================================
// LIST
// ============================================================

export async function listPipelines(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await pipelinesService.listPipelines(
      actor,
      req.params.projectId,
      req.query as unknown as PipelineListQuery,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// DETAIL
// ============================================================

export async function getPipeline(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const pipeline = await pipelinesService.getPipeline(
      actor,
      req.params.projectId,
      req.params.id,
    );
    res.json({ pipeline });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// RUN
// ============================================================

export async function runPipeline(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const pipeline = await pipelinesService.runPipeline(
      actor,
      req.params.projectId,
      req.body as RunPipelineInput,
    );
    res.status(202).json({ pipeline });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// CANCEL
// ============================================================

export async function cancelPipeline(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    await pipelinesService.cancelPipeline(
      actor,
      req.params.projectId,
      req.params.id,
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// ============================================================
// LOGS
// ============================================================

export async function getPipelineLogs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await pipelinesService.getPipelineLogs(
      actor,
      req.params.projectId,
      req.params.id,
      req.query as unknown as PipelineLogsQuery,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// SCANS
// ============================================================

export async function getPipelineScans(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await pipelinesService.getPipelineScans(
      actor,
      req.params.projectId,
      req.params.id,
      req.query as unknown as PipelineScansQuery,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// REPORT
// ============================================================

export async function getPipelineReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const result = await pipelinesService.getPipelineReport(
      actor,
      req.params.projectId,
      req.params.id,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// DELETE
// ============================================================
export async function deletePipeline(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    await pipelinesService.deletePipeline(
      actor,
      req.params.projectId,
      req.params.id,
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}


export async function downloadPipelineLogs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const content = await pipelinesService.downloadPipelineLogs(
      actor,
      req.params.projectId,
      req.params.id,
    );
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="pipeline-${req.params.id}.log"`,
    );
    res.send(content);
  } catch (err) {
    next(err);
  }
}
