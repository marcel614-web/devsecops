// apps/api/src/utils/errors.ts

/**
 * Hiérarchie d'erreurs contrôlées.
 * Objectif : ne jamais laisser fuiter une stack ou un message interne
 * vers le client. Le middleware errorHandler traduit ces classes en
 * réponses HTTP propres.
 */

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code = "INTERNAL_ERROR",
    details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Requête invalide", details?: unknown) {
    super(message, 400, "BAD_REQUEST", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Non authentifié") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Accès interdit") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Ressource introuvable") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflit", details?: unknown) {
    super(message, 409, "CONFLICT", details);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message = "Entité non traitable", details?: unknown) {
    super(message, 422, "UNPROCESSABLE_ENTITY", details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Trop de requêtes") {
    super(message, 429, "TOO_MANY_REQUESTS");
  }
}