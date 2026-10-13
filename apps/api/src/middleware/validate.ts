// apps/api/src/middleware/validate.ts
import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodSchema } from "zod";
import { BadRequestError } from "../utils/errors";

interface Schemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Middleware de validation Zod.
 * - Remplace req.body / req.query / req.params par la version parsée (typée).
 * - Rejette avec 400 et le détail des erreurs.
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        // On réassigne pour bénéficier des transformations Zod
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        }));
        return next(new BadRequestError("Données invalides", details));
      }
      next(err);
    }
  };
}