// apps/api/src/modules/github/github-api-error.ts
import { AppError } from "../../utils/errors";

/**
 * Traduction des erreurs de l'API GitHub en erreurs applicatives contrôlées.
 *
 * Objectif : ne jamais transformer une erreur GitHub en succès, et ne jamais
 * exposer la réponse brute (qui peut contenir des URLs internes ou des
 * identifiants) au frontend. On conserve le statut HTTP et un message
 * compréhensible, sans secret.
 */

export interface GitHubErrorDetails {
  status: number | null;
  message: string;
  retryAfterSeconds: number | null;
  rateLimited: boolean;
  timedOut: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readHeader(
  headers: unknown,
  name: string,
): string | null {
  const obj = asRecord(headers);
  if (!obj) return null;
  const value = obj[name] ?? obj[name.toLowerCase()];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

export function readGitHubError(err: unknown): GitHubErrorDetails {
  const root = asRecord(err);
  const response = asRecord(root?.response);
  const responseData = asRecord(response?.data);

  const rawStatus = root?.status ?? response?.status;
  const status = typeof rawStatus === "number" ? rawStatus : null;

  const message =
    (typeof responseData?.message === "string" && responseData.message) ||
    (typeof root?.message === "string" && root.message) ||
    "Erreur inconnue de l'API GitHub";

  const retryAfterHeader = readHeader(response?.headers, "retry-after");
  const parsedRetryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  const retryAfterSeconds = Number.isFinite(parsedRetryAfter)
    ? Math.max(0, Math.floor(parsedRetryAfter))
    : null;

  const remaining = readHeader(response?.headers, "x-ratelimit-remaining");
  const lowerMessage = message.toLowerCase();
  const rateLimited =
    status === 429 ||
    remaining === "0" ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("secondary rate");

  const rawName = root?.name ?? response?.name;
  const timedOut =
    rawName === "TimeoutError" ||
    rawName === "AbortError" ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("aborted");

  return { status, message, retryAfterSeconds, rateLimited, timedOut };
}

function detailsOf(details: GitHubErrorDetails): Record<string, unknown> {
  return {
    githubStatus: details.status,
    githubMessage: details.message,
    retryAfterSeconds: details.retryAfterSeconds,
  };
}

/**
 * Convertit une erreur GitHub en AppError avec un code stable.
 * `context` décrit l'action en français (ex. « création de l'équipe »).
 */
export function toGitHubAppError(err: unknown, context: string): AppError {
  if (err instanceof AppError) return err;

  const details = readGitHubError(err);

  if (details.timedOut) {
    return new AppError(
      `${context} : GitHub n'a pas répondu dans le délai imparti. Réessayez.`,
      504,
      "GITHUB_TIMEOUT",
      detailsOf(details),
    );
  }

  if (details.rateLimited) {
    return new AppError(
      `${context} : la limite de requêtes GitHub est atteinte. ` +
        (details.retryAfterSeconds !== null
          ? `Réessayez dans ${details.retryAfterSeconds} seconde(s).`
          : "Réessayez dans quelques minutes."),
      429,
      "GITHUB_RATE_LIMITED",
      detailsOf(details),
    );
  }

  switch (details.status) {
    case 401:
      return new AppError(
        `${context} : GitHub a refusé l'authentification de l'application. ` +
          "Vérifiez la configuration de la GitHub App (App ID et clé privée).",
        401,
        "GITHUB_UNAUTHORIZED",
        detailsOf(details),
      );
    case 403:
      return new AppError(
        `${context} : GitHub a refusé l'opération. ` +
          "L'installation de la GitHub App ou l'utilisateur GitHub ne dispose pas des droits nécessaires sur cette organisation. " +
          "Vérifiez les permissions de l'application et votre rôle dans l'organisation.",
        403,
        "GITHUB_FORBIDDEN",
        detailsOf(details),
      );
    case 404:
      return new AppError(
        `${context} : ressource introuvable sur GitHub (organisation, équipe, dépôt ou utilisateur inexistant, ou accès non accordé à l'installation).`,
        404,
        "GITHUB_NOT_FOUND",
        detailsOf(details),
      );
    case 422:
      return new AppError(
        `${context} : GitHub a rejeté les données fournies. ${details.message}`,
        422,
        "GITHUB_UNPROCESSABLE",
        detailsOf(details),
      );
    default:
      return new AppError(
        `${context} : GitHub a renvoyé une erreur inattendue${
          details.status ? ` (HTTP ${details.status})` : ""
        }. ${details.message}`,
        502,
        "GITHUB_UPSTREAM_ERROR",
        detailsOf(details),
      );
  }
}

export interface AppPermissions {
  [key: string]: string | undefined;
}

export interface TeamCapabilities {
  canReadTeams: boolean;
  canWriteTeams: boolean;
  canManageRepoPermissions: boolean;
  appPermissions: AppPermissions;
  missingPermissions: string[];
  requiredPermissions: string[];
}

const REQUIRED_PERMISSIONS = [
  "Members: read — afficher les équipes et leurs membres",
  "Members: write — créer des équipes et gérer les appartenances",
  "Administration: write — modifier les permissions des dépôts associés aux équipes",
  "Metadata: read — implicite, nécessaire à la lecture des dépôts",
] as const;

export function buildTeamCapabilities(
  permissions: Record<string, unknown> | null | undefined,
): TeamCapabilities {
  const appPermissions: AppPermissions = {};
  for (const [key, value] of Object.entries(permissions ?? {})) {
    if (typeof value === "string") appPermissions[key] = value;
  }

  const members = appPermissions.members;
  const administration = appPermissions.administration;

  const canReadTeams = members === "read" || members === "write";
  const canWriteTeams = members === "write";
  const canManageRepoPermissions = administration === "write";

  const missingPermissions: string[] = [];
  if (!canReadTeams) missingPermissions.push("Members: read");
  if (!canWriteTeams) missingPermissions.push("Members: write");
  if (!canManageRepoPermissions) missingPermissions.push("Administration: write");

  return {
    canReadTeams,
    canWriteTeams,
    canManageRepoPermissions,
    appPermissions,
    missingPermissions,
    requiredPermissions: [...REQUIRED_PERMISSIONS],
  };
}

export function permissionRequiredError(
  action: string,
  missing: string[],
): AppError {
  return new AppError(
    `${action} : permissions GitHub App insuffisantes (${missing.join(", ")}). ` +
      "Mettez à jour les permissions de la GitHub App dans ses paramètres, " +
      "puis acceptez la mise à jour de l'installation sur l'organisation.",
    403,
    "GITHUB_PERMISSION_MISSING",
    { missingPermissions: missing },
  );
}
