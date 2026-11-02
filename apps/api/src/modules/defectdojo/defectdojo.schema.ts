// apps/api/src/modules/defectdojo/defectdojo.schema.ts
import { z } from "zod";

export const updateDefectDojoConfigSchema = z
  .object({
    url: z.string().trim().url().optional(),
    apiToken: z.string().trim().min(1).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Au moins un champ est requis",
  });

export const testDefectDojoConfigSchema = z.object({
  url: z.string().trim().url().optional(),
  apiToken: z.string().trim().min(1).optional(),
});

export const exportDefectDojoSchema = z.object({
  pipelineId: z.string().min(1),
  engagementId: z.number().int().positive(),
});