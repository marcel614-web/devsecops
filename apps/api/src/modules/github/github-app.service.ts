// apps/api/src/modules/github/github-app.service.ts
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { Octokit } from "@octokit/rest";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";

// Cache en mémoire des tokens d'installation (valides 1h)
interface CachedToken {
  token: string;
  expiresAt: number; // timestamp ms
}

const tokenCache = new Map<string, CachedToken>();

/**
 * Lit la clé privée depuis le chemin ou depuis la variable inline.
 */
function loadPrivateKey(): string {
  if (env.GITHUB_APP_PRIVATE_KEY_PATH) {
    const p = path.resolve(env.GITHUB_APP_PRIVATE_KEY_PATH);
    return fs.readFileSync(p, "utf8");
  }
  if (env.GITHUB_APP_PRIVATE_KEY) {
    // Remplace les \n littéraux par de vrais retours ligne
    return env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  throw new Error(
    "Aucune clé privée GitHub App configurée (GITHUB_APP_PRIVATE_KEY_PATH ou GITHUB_APP_PRIVATE_KEY)",
  );
}

let cachedPrivateKey: string | null = null;
function getPrivateKey(): string {
  if (!cachedPrivateKey) {
    cachedPrivateKey = loadPrivateKey();
  }
  return cachedPrivateKey;
}

/**
 * Génère un JWT signé pour s'authentifier en tant que GitHub App.
 * Valide max 10 minutes.
 */
function generateAppJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60, // tolérance d'horloge
      exp: now + 9 * 60, // 9 minutes (max autorisé : 10)
      iss: env.GITHUB_APP_ID,
    },
    getPrivateKey(),
    { algorithm: "RS256" },
  );
}

/**
 * Retourne un Octokit authentifié en tant qu'App (pour les endpoints /app/*).
 */
export function getAppOctokit(): Octokit {
  return new Octokit({
    auth: generateAppJwt(),
    userAgent: "devsecops-platform",
  });
}

/**
 * Récupère (ou renouvelle) un token d'installation.
 * Les tokens sont valides 1h, on les cache 55 min.
 */
export async function getInstallationToken(
  installationId: string,
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const appOctokit = getAppOctokit();
  const { data } = await appOctokit.apps.createInstallationAccessToken({
    installation_id: Number(installationId),
  });

  const expiresAt = data.expires_at
    ? new Date(data.expires_at).getTime()
    : Date.now() + 55 * 60_000;

  tokenCache.set(installationId, {
    token: data.token,
    expiresAt: expiresAt - 5 * 60_000, // marge de 5 min
  });

  logger.debug(
    { installationId, expiresAt: data.expires_at },
    "Token d'installation GitHub App obtenu",
  );

  return data.token;
}

/**
 * Octokit scoped sur une installation (pour accéder aux repos).
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
 * Vérifie qu'une installation existe côté GitHub (via App JWT).
 */
export async function fetchInstallation(installationId: string) {
  const appOctokit = getAppOctokit();
  const { data } = await appOctokit.apps.getInstallation({
    installation_id: Number(installationId),
  });
  return data;
}

// ============================================================
// STATE SIGNÉ POUR LE FLUX D'INSTALLATION
// ============================================================

const STATE_TTL_MS = 15 * 60_000; // 15 min

/**
 * Signe un state pour le retour d'installation GitHub.
 * Format : base64url(payload).signature
 * - payload : JSON { userId, ts, nonce }
 * - signature : HMAC-SHA256 du payload avec le webhook secret
 */
export function signInstallState(userId: string): string {
  const payload = JSON.stringify({
    userId,
    ts: Date.now(),
    nonce: crypto.randomUUID(),
  });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", env.GITHUB_APP_WEBHOOK_SECRET)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sig}`;
}

/**
 * Vérifie et décode un state d'installation.
 * Lève une erreur si invalide ou expiré.
 */
export function verifyInstallState(state: string): { userId: string } {
  const parts = state.split(".");
  if (parts.length !== 2) {
    throw new Error("State malformé");
  }

  const [payloadB64, providedSig] = parts;
  const expectedSig = crypto
    .createHmac("sha256", env.GITHUB_APP_WEBHOOK_SECRET)
    .update(payloadB64)
    .digest("base64url");

  // Comparaison à temps constant
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
export function buildInstallUrl(userId: string): string {
  const state = signInstallState(userId);
  const params = new URLSearchParams({ state });
  return `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?${params.toString()}`;
}

/**
 * Invalide le cache de tokens pour une installation (utile après désinstallation).
 */
export function invalidateInstallationToken(installationId: string): void {
  tokenCache.delete(installationId);
}