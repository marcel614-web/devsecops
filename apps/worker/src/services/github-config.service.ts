// apps/worker/src/services/github-config.service.ts
import { prisma } from "../utils/prisma";
import { decryptString } from "../utils/crypto";
import { logger } from "../utils/logger";

const SINGLETON_KEY = "default";

export interface GithubAppConfig {
  appId: string;
  slug: string;
  privateKey: string;
  webhookSecret: string | null;
  clientId: string | null;
  clientSecret: string | null;
}

// Cache local (invalidé à chaque démarrage du worker)
let cachedConfig: GithubAppConfig | null | undefined = undefined;

/**
 * Charge la config GitHub App depuis la base.
 * Retourne null si non configurée.
 */
export async function getGithubAppConfig(): Promise<GithubAppConfig | null> {
  if (cachedConfig !== undefined) return cachedConfig;

  const row = await prisma.systemConfig.findUnique({
    where: { key: SINGLETON_KEY },
    select: {
      githubAppId: true,
      githubAppSlug: true,
      githubPrivateKeyEncrypted: true,
      githubWebhookSecretEncrypted: true,
      githubClientId: true,
      githubClientSecretEncrypted: true,
      githubConfigured: true,
    },
  });

  if (!row?.githubConfigured || !row.githubAppId || !row.githubAppSlug) {
    cachedConfig = null;
    return null;
  }

  let privateKey = "";
  try {
    privateKey = row.githubPrivateKeyEncrypted
      ? decryptString(row.githubPrivateKeyEncrypted)
      : "";
  } catch (err) {
    logger.error(
      { err },
      "Impossible de déchiffrer la clé privée GitHub App",
    );
    cachedConfig = null;
    return null;
  }

  let webhookSecret: string | null = null;
  try {
    webhookSecret = row.githubWebhookSecretEncrypted
      ? decryptString(row.githubWebhookSecretEncrypted)
      : null;
  } catch {
    webhookSecret = null;
  }

  let clientSecret: string | null = null;
  try {
    clientSecret = row.githubClientSecretEncrypted
      ? decryptString(row.githubClientSecretEncrypted)
      : null;
  } catch {
    clientSecret = null;
  }

  if (!privateKey) {
    cachedConfig = null;
    return null;
  }

  cachedConfig = {
    appId: row.githubAppId,
    slug: row.githubAppSlug,
    privateKey,
    webhookSecret,
    clientId: row.githubClientId,
    clientSecret,
  };

  return cachedConfig;
}

export function invalidateGithubConfigCache(): void {
  cachedConfig = undefined;
}