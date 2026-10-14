// apps/api/src/middleware/rawBody.ts
import type { Request, Response, NextFunction } from "express";

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
  req.setEncoding("utf8");
  req.on("data", (chunk: string) => {
    raw += chunk;
  });
  req.on("end", () => {
    (req as Request & { rawBody?: string }).rawBody = raw;
    try {
      (req as Request & { body?: unknown }).body = raw ? JSON.parse(raw) : {};
    } catch {
      (req as Request & { body?: unknown }).body = {};
    }
    next();
  });
}