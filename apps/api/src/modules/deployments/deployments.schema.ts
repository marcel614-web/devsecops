import { z } from "zod";

export const deploymentIdParamSchema = z.object({
  id: z.string().min(1),
});