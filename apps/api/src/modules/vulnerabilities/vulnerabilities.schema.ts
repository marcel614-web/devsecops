// apps/api/src/modules/vulnerabilities/vulnerabilities.schema.ts
import { z } from "zod";
import { Severity } from "@prisma/client";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants";

export const projectIdParamSchema = z.object({
  projectId: z.string().min(1),
});

export const vulnerabilityListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  severity: z.nativeEnum(Severity).optional(),
  tool: z.string().trim().min(1).max(50).optional(),
  pipelineId: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export type VulnerabilityListQuery = z.infer<typeof vulnerabilityListQuerySchema>;