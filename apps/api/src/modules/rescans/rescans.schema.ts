// apps/api/src/modules/rescans/rescans.schema.ts
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants";

export const rescanProjectParamSchema = z.object({
  projectId: z.string().min(1),
});

export const rescanRunParamSchema = rescanProjectParamSchema.extend({
  runId: z.string().min(1),
});

export const rescanListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export const remediationSchema = z.object({
  reason: z.string().trim().min(10).max(500).optional(),
});

export type RescanListQuery = z.infer<typeof rescanListQuerySchema>;
export type RemediationInput = z.infer<typeof remediationSchema>;
