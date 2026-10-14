// apps/api/src/modules/github/github-app.service.ts
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { Octokit } from "@octokit/rest";
import { logger } from "../../utils/logger";
import { getGithubConfigInternal } from "../system-config/system-config.service";

// ============================================================
// CACHE DES TOKENS D'INSTALLATION (1h, cachés 55 min)
// ============================================================
interface CachedToken {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<string, CachedToken>();

// ============================================================
// JWT APP
// ============================================================

/**
 * Génère un JWT signé avec la clé privée stockée en base.
 * Lève une erreur explicite si la config est incomplète.
 */
async function generateAppJwt(): Promise<string> {
  const config = await getGithubConfigInternal();
  if (!config) {
    throw new Error(
      "GitHub App non configurée. Va dans Paramètres → GitHub App pour la configurer.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 9 * 60,
      iss: config.appId,
    },
    config.privateKey,
    { algorithm: "RS256" },
  );
}

// ============================================================
// OCTOKIT
// ============================================================

/**
 * Retourne un Octokit authentifié en tant qu'App.
 * Utilisé pour les endpoints /app/* (gestion des installations).
 */
export async function getAppOctokit(): Promise<Octokit> {
  const appJwt = await generateAppJwt();
  return new Octokit({
    auth: appJwt,
    userAgent: "devsecops-platform",
  });
}

/**
 * Récupère (ou renouvelle) un token d'installation.
 * Les tokens GitHub sont valides 1h, on les cache 55 min.
 */
export async function getInstallationToken(
  installationId: string,
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const appOctokit = await getAppOctokit();
  const { data } = await appOctokit.apps.createInstallationAccessToken({
    installation_id: Number(installationId),
  });

  const expiresAt = data.expires_at
    ? new Date(data.expires_at).getTime()
    : Date.now() + 55 * 60_000;

  tokenCache.set(installationId, {
    token: data.token,
    expiresAt: expiresAt - 5 * 60_000,
  });

  logger.debug(
    { installationId, expiresAt: data.expires_at },
    "Token d'installation GitHub App obtenu",
  );

  return data.token;
}

/**
 * Octokit scoped sur une installation (accès aux repos de cette installation).
 */
export async function getInstallationOctokit(
  installationId: string,
): Promise<Octokit> {
  const token = await getInstallationToken(installationId);
  return new Octokit({
    auth: token,
    userAgent: "devsecops-platform",
  });
}

/**
 * Vérifie qu'une installation existe côté GitHub.
 */
export async function fetchInstallation(installationId: string) {
  const appOctokit = await getAppOctokit();
  const { data } = await appOctokit.apps.getInstallation({
    installation_id: Number(installationId),
  });
  return data;
}

// ============================================================
// STATE SIGNÉ POUR LE FLUX D'INSTALLATION
// ============================================================

const STATE_TTL_MS = 15 * 60_000; // 15 min

async function getWebhookSecret(): Promise<string> {
  const config = await getGithubConfigInternal();
  if (!config) {
    throw new Error("GitHub App non configurée.");
  }
  return config.webhookSecret;
}

/**
 * Signe un state pour le retour d'installation GitHub.
 * Format : base64url(payload).signature
 */
export async function signInstallState(userId: string): Promise<string> {
  const secret = await getWebhookSecret();
  const payload = JSON.stringify({
    userId,
    ts: Date.now(),
    nonce: crypto.randomUUID(),
  });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sig}`;
}

/**
 * Vérifie et décode un state d'installation.
 * Lève une erreur si invalide ou expiré.
 */
export async function verifyInstallState(
  state: string,
): Promise<{ userId: string }> {
  const secret = await getWebhookSecret();
  const parts = state.split(".");
  if (parts.length !== 2) {
    throw new Error("State malformé");
  }

  const [payloadB64, providedSig] = parts;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64url");

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Signature de state invalide");
  }

  const payload = JSON.parse(
    Buffer.from(payloadB64, "base64url").toString("utf8"),
  ) as { userId: string; ts: number; nonce: string };

  if (Date.now() - payload.ts > STATE_TTL_MS) {
    throw new Error("State expiré");
  }

  return { userId: payload.userId };
}

/**
 * Construit l'URL d'installation officielle de la GitHub App.
 */
export async function buildInstallUrl(userId: string): Promise<string> {
  const config = await getGithubConfigInternal();
  if (!config) {
    throw new Error(
      "GitHub App non configurée. Va dans Paramètres → GitHub App.",
    );
  }
  const state = await signInstallState(userId);
  const params = new URLSearchParams({ state });
  return `https://github.com/apps/${config.slug}/installations/new?${params.toString()}`;
}

/**
 * Invalide le cache de tokens (utile après désinstallation).
 */
export function invalidateInstallationToken(installationId: string): void {
  tokenCache.delete(installationId);
}