import { z } from "zod";

export const reportListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  projectId: z.string().optional(),
});

export const reportIdParamSchema = z.object({
  id: z.string().min(1),
});