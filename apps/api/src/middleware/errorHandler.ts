// apps/api/src/middleware/errorHandler.ts
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../utils/errors";
import { logError } from "../utils/logger";
import { env, isDev } from "../config/env";

interface ErrorPayload {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Middleware final de gestion d'erreurs.
 * DOIT être enregistré en dernier avec app.use(errorHandler).
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = res.locals.requestId as string | undefined;

  // 1. Erreurs contrôlées (AppError et sous-classes)
  if (err instanceof AppError) {
    logError("Erreur applicative", err, {
      path: req.path,
      method: req.method,
      requestId,
    });

    const payload: ErrorPayload = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    };
    res.status(err.statusCode).json(payload);
    return;
  }

  // 2. Erreurs Zod non capturées par validate()
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Données invalides",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        requestId,
      },
    });
    return;
  }

  // 3. Erreurs Prisma connues
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({
        error: {
          code: "CONFLICT",
          message: "Cette ressource existe déjà",
          requestId,
        },
      });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Ressource introuvable",
          requestId,
        },
      });
      return;
    }
  }

  // 4. Erreur inconnue : on masque tout
  logError("Erreur interne non gérée", err, {
    path: req.path,
    method: req.method,
    requestId,
  });

  const payload: ErrorPayload = {
    error: {
      code: "INTERNAL_ERROR",
      message: "Une erreur interne est survenue",
      requestId,
      ...(isDev && err instanceof Error ? { details: err.message } : {}),
    },
  };
  res.status(500).json(payload);
}