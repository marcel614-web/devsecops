// apps/api/src/modules/pipelines/pipelines.schema.ts
import { z } from "zod";
import { PipelineStatus, Severity } from "@prisma/client";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants";

export const projectIdParamSchema = z.object({
  projectId: z.string().min(1),
});

export const projectPipelineParamSchema = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
});

export const pipelineListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.nativeEnum(PipelineStatus).optional(),
  branch: z.string().trim().min(1).max(120).optional(),
});

export const runPipelineSchema = z.object({
  commitSha: z.string().trim().min(1).max(100).optional(),
  branch: z.string().trim().min(1).max(120).optional(),
  author: z.string().trim().min(1).max(200).optional(),
  trigger: z.string().trim().min(1).max(50).optional(),
});

export const pipelineLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(1000).default(500),
  stepId: z.string().min(1).optional(),
  level: z.enum(["info", "warn", "error", "debug"]).optional(),
});

export const pipelineScansQuerySchema = z.object({
  type: z.enum(["SECRET", "SAST", "SCA", "IMAGE", "DAST"]).optional(),
});

export const vulnerabilityListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  severity: z.nativeEnum(Severity).optional(),
  tool: z.string().trim().min(1).max(50).optional(),
  pipelineId: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export type RunPipelineInput = z.infer<typeof runPipelineSchema>;
export type PipelineListQuery = z.infer<typeof pipelineListQuerySchema>;
export type PipelineLogsQuery = z.infer<typeof pipelineLogsQuerySchema>;
export type PipelineScansQuery = z.infer<typeof pipelineScansQuerySchema>;
export type VulnerabilityListQuery = z.infer<typeof vulnerabilityListQuerySchema>;