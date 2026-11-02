// apps/api/src/modules/verifications/verifications.schema.ts
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants";

export const verificationProjectParamSchema = z.object({
  projectId: z.string().min(1),
});

export const verificationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export type VerificationListQuery = z.infer<typeof verificationListQuerySchema>;
