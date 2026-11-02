// apps/api/src/modules/dependency-track/dependency-track.schema.ts
import { z } from "zod";

export const updateDependencyTrackConfigSchema = z
  .object({
    url: z.string().trim().url().optional(),
    apiKey: z.string().trim().min(1).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Au moins un champ est requis" });

export const testDependencyTrackConfigSchema = z.object({
  url: z.string().trim().url().optional(),
  apiKey: z.string().trim().min(1).optional(),
});