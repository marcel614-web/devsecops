// apps/api/src/modules/defectdojo/defectdojo.controller.ts
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import * as service from "./defectdojo.service";

function actorFrom(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function getConfig(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ config: await service.getDefectDojoConfigPublic() });
  } catch (err) {
    next(err);
  }
}

export async function updateConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const config = await service.updateDefectDojoConfig(req.body, actor.id);
    res.json({ config });
  } catch (err) {
    next(err);
  }
}

export async function testConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.testDefectDojoConnection(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function exportPipeline(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = actorFrom(req);
    const projectId = req.params.projectId;
    const { pipelineId, engagementId } = req.body;
    const result = await service.syncPipelineToDefectDojo({
      projectId,
      pipelineId,
      engagementId,
    });
    await service.listDefectDojoImports(projectId).catch(() => undefined);
    void actor;
    res.status(result.status === "SUCCESS" ? 200 : 502).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listImports(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;
    const imports = await service.listDefectDojoImports(projectId);
    res.json({ imports });
  } catch (err) {
    next(err);
  }
}