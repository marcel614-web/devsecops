// apps/api/src/modules/github/github-app.service.ts
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { Octokit } from "@octokit/rest";
import { logger } from "../../utils/logger";
import { getGithubConfigInternal } from "../system-config/system-config.service";
import { env } from "../../config/env";

// ============================================================
// CACHE DES TOKENS D'INSTALLATION
// ============================================================
interface CachedToken {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<string, CachedToken>();

// ============================================================
// SECRET POUR SIGNER LES STATE OAUTH
// ============================================================
// Si le webhook secret n'est pas configuré (mode manuel uniquement),
// on utilise JWT_ACCESS_SECRET comme secret HMAC pour signer les state.
// Ça évite de bloquer l'installation quand le webhook est désactivé.
async function getStateSigningSecret(): Promise<string> {
  const config = await getGithubConfigInternal();
  if (config?.webhookSecret) return config.webhookSecret;
  return env.JWT_ACCESS_SECRET;
}

// ============================================================
// JWT APP
// ============================================================
async function generateAppJwt(): Promise<string> {
  const config = await getGithubConfigInternal();
  if (!config) {
    throw new Error(
      "GitHub App non configurée. Va dans Paramètres → GitHub App pour la configurer.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iat: now - 60, exp: now + 9 * 60, iss: config.appId },
    config.privateKey,
    { algorithm: "RS256" },
  );
}

// ============================================================
// OCTOKIT
// ============================================================
export async function getAppOctokit(): Promise<Octokit> {
  const appJwt = await generateAppJwt();
  return new Octokit({ auth: appJwt, userAgent: "devsecops-platform" });
}

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

export async function getInstallationOctokit(
  installationId: string,
): Promise<Octokit> {
  const token = await getInstallationToken(installationId);
  return new Octokit({ auth: token, userAgent: "devsecops-platform" });
}

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
const STATE_TTL_MS = 15 * 60_000;

export async function signInstallState(userId: string): Promise<string> {
  const secret = await getStateSigningSecret();
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

export async function verifyInstallState(
  state: string,
): Promise<{ userId: string }> {
  const secret = await getStateSigningSecret();
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

export function invalidateInstallationToken(installationId: string): void {
  tokenCache.delete(installationId);
}