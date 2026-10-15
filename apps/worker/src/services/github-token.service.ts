// apps/worker/src/services/github-token.service.ts
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger";
import { getGithubAppConfig } from "./github-config.service";

// ============================================================
// CACHE DES TOKENS D'INSTALLATION
// ============================================================
interface CachedToken {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<string, CachedToken>();

/**
 * Génère un JWT signé avec la clé privée GitHub App.
 */
async function generateAppJwt(): Promise<string> {
  const config = await getGithubAppConfig();
  if (!config) {
    throw new Error(
      "GitHub App non configurée. Contactez un administrateur de la plateforme.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iat: now - 60, exp: now + 9 * 60, iss: config.appId },
    config.privateKey,
    { algorithm: "RS256" },
  );
}

/**
 * Échange un JWT App contre un installation access token GitHub.
 * Le token est caché 55 minutes (valide 1h côté GitHub).
 */
export async function getInstallationToken(
  installationId: string,
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const appJwt = await generateAppJwt();

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    logger.error(
      { installationId, status: res.status, body: text.slice(0, 300) },
      "Échec de création du token d'installation",
    );
    throw new Error(
      `Impossible de créer le token d'installation (HTTP ${res.status})`,
    );
  }

  const data = (await res.json()) as {
    token: string;
    expires_at: string;
  };

  const expiresAt = data.expires_at
    ? new Date(data.expires_at).getTime()
    : Date.now() + 55 * 60_000;

  tokenCache.set(installationId, {
    token: data.token,
    expiresAt: expiresAt - 5 * 60_000,
  });

  logger.debug(
    { installationId, expiresAt: data.expires_at },
    "Token d'installation GitHub généré",
  );

  return data.token;
}

/**
 * Invalide le cache pour une installation donnée.
 */
export function invalidateInstallationToken(installationId: string): void {
  tokenCache.delete(installationId);
}