// apps/api/src/middleware/rawBody.ts
import type { Request, Response, NextFunction } from "express";
import { PayloadTooLargeError } from "../utils/errors";

/**
 * Taille maximale du corps brut accepté sur la route webhook.
 *
 * Le webhook est monté AVANT `express.json({ limit: "1mb" })`, donc la
 * limite standard d'Express ne s'appliquait pas : un attaquant non
 * authentifié pouvait envoyer un corps de taille arbitraire et saturer la
 * mémoire du processus. On impose donc notre propre plafond.
 */
export const MAX_RAW_BODY_BYTES = 5 * 1024 * 1024; // 5 Mo

/**
 * Middleware à utiliser AVANT express.json() sur la route webhook.
 * Capture le corps brut et le stocke sur req.rawBody.
 */
export function rawBodyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  let raw = "";
  let size = 0;
  let rejected = false;

  req.setEncoding("utf8");

  req.on("data", (chunk: string) => {
    if (rejected) return;

    size += Buffer.byteLength(chunk, "utf8");
    if (size > MAX_RAW_BODY_BYTES) {
      rejected = true;
      raw = "";
      // On interrompt la lecture (sans détruire la socket : la réponse
      // 413 doit pouvoir partir) puis on remonte l'erreur.
      req.pause();
      next(new PayloadTooLargeError("Corps de requête trop volumineux"));
      return;
    }

    raw += chunk;
  });

  req.on("end", () => {
    if (rejected) return;

    (req as Request & { rawBody?: string }).rawBody = raw;
    try {
      (req as Request & { body?: unknown }).body = raw ? JSON.parse(raw) : {};
    } catch {
      (req as Request & { body?: unknown }).body = {};
    }
    next();
  });

  req.on("error", () => {
    if (rejected) return;
    next(new PayloadTooLargeError("Corps de requête illisible"));
  });
}
