// apps/api/src/modules/vulnerabilities/vulnerabilities.schema.ts
import { z } from "zod";
import {
  ScanType,
  Severity,
  VulnerabilityStatus,
} from "@prisma/client";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants";

export const projectIdParamSchema = z.object({
  projectId: z.string().min(1),
});

export const vulnerabilityParamSchema = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
});

export const vulnerabilityListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  severity: z.nativeEnum(Severity).optional(),
  status: z.nativeEnum(VulnerabilityStatus).optional(),
  scanType: z.nativeEnum(ScanType).optional(),
  tool: z.string().trim().min(1).max(50).optional(),
  pipelineId: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export const updateVulnerabilitySchema = z
  .object({
    status: z.nativeEnum(VulnerabilityStatus).optional(),
    assignedToId: z.string().min(1).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Au moins un champ à modifier est requis",
  });

export type VulnerabilityListQuery = z.infer<typeof vulnerabilityListQuerySchema>;
export type UpdateVulnerabilityInput = z.infer<typeof updateVulnerabilitySchema>;
