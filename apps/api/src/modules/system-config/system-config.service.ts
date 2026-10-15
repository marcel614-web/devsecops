// apps/api/src/modules/system-config/system-config.service.ts
import { prisma } from "../../utils/prisma";
import { encryptString, decryptString } from "../../secrets/crypto";
import { logInfo } from "../../utils/logger";

const SINGLETON_KEY = "default";

// ============================================================
// CACHE EN MÉMOIRE
// ============================================================

interface GithubAppConfigInternal {
  appId: string;
  slug: string;
  privateKey: string;
  webhookSecret: string;
  clientId: string | null;
  clientSecret: string | null;
  configured: boolean;
}

interface GithubAppConfigPublic {
  appId: string | null;
  slug: string | null;
  hasPrivateKey: boolean;
  hasWebhookSecret: boolean;
  clientId: string | null;
  hasClientSecret: boolean;
  configured: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

let cache: GithubAppConfigInternal | null | undefined = undefined;

export function invalidateGithubConfigCache(): void {
  cache = undefined;
}

/**
 * Charge la config GitHub App depuis la base ou depuis les env
 * (fallback pour bootstrap). Résultat mis en cache.
 */
async function loadGithubConfig(): Promise<GithubAppConfigInternal | null> {
  if (cache !== undefined) return cache;

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
    // Fallback : variables d'env
    const envModule = await import("../../config/env");
    const {
      GITHUB_APP_ID,
      GITHUB_APP_SLUG,
      GITHUB_APP_PRIVATE_KEY_PATH,
      GITHUB_APP_PRIVATE_KEY,
      GITHUB_APP_WEBHOOK_SECRET,
      GITHUB_APP_CLIENT_ID,
      GITHUB_APP_CLIENT_SECRET,
    } = envModule.env;

    if (!GITHUB_APP_ID || !GITHUB_APP_SLUG || !GITHUB_APP_WEBHOOK_SECRET) {
      cache = null;
      return null;
    }

    let privateKey = GITHUB_APP_PRIVATE_KEY ?? "";
    if (!privateKey && GITHUB_APP_PRIVATE_KEY_PATH) {
      const fs = await import("node:fs");
      try {
        privateKey = fs.readFileSync(GITHUB_APP_PRIVATE_KEY_PATH, "utf8");
      } catch {
        cache = null;
        return null;
      }
    }

    if (!privateKey) {
      cache = null;
      return null;
    }

    cache = {
      appId: GITHUB_APP_ID,
      slug: GITHUB_APP_SLUG,
      privateKey,
      webhookSecret: GITHUB_APP_WEBHOOK_SECRET,
      clientId: GITHUB_APP_CLIENT_ID ?? null,
      clientSecret: GITHUB_APP_CLIENT_SECRET ?? null,
      configured: true,
    };
    return cache;
  }

  // Déchiffre les secrets
  const privateKey = row.githubPrivateKeyEncrypted
    ? decryptString(row.githubPrivateKeyEncrypted)
    : "";
  const webhookSecret = row.githubWebhookSecretEncrypted
    ? decryptString(row.githubWebhookSecretEncrypted)
    : "";
  const clientSecret = row.githubClientSecretEncrypted
    ? decryptString(row.githubClientSecretEncrypted)
    : null;

  if (!privateKey || !webhookSecret) {
    cache = null;
    return null;
  }

  cache = {
    appId: row.githubAppId,
    slug: row.githubAppSlug,
    privateKey,
    webhookSecret,
    clientId: row.githubClientId,
    clientSecret,
    configured: true,
  };
  return cache;
}

export async function getGithubConfigInternal(): Promise<GithubAppConfigInternal | null> {
  return loadGithubConfig();
}

export async function getGithubConfigPublic(): Promise<GithubAppConfigPublic> {
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
      updatedAt: true,
      updatedBy: true,
    },
  });

  if (!row) {
    return {
      appId: null,
      slug: null,
      hasPrivateKey: false,
      hasWebhookSecret: false,
      clientId: null,
      hasClientSecret: false,
      configured: false,
      updatedAt: null,
      updatedBy: null,
    };
  }

  return {
    appId: row.githubAppId,
    slug: row.githubAppSlug,
    hasPrivateKey: !!row.githubPrivateKeyEncrypted,
    hasWebhookSecret: !!row.githubWebhookSecretEncrypted,
    clientId: row.githubClientId,
    hasClientSecret: !!row.githubClientSecretEncrypted,
    configured: row.githubConfigured,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

// ============================================================
// UPDATE
// ============================================================

export interface UpdateGithubConfigInput {
  appId?: string;
  slug?: string;
  privateKey?: string;
  webhookSecret?: string;
  clientId?: string;
  clientSecret?: string;
  markConfigured?: boolean;
}

export async function updateGithubConfig(
  input: UpdateGithubConfigInput,
  actorId: string,
): Promise<GithubAppConfigPublic> {
  const data: Record<string, unknown> = { updatedBy: actorId };

  if (input.appId !== undefined) data.githubAppId = input.appId.trim() || null;
  if (input.slug !== undefined) data.githubAppSlug = input.slug.trim() || null;
  if (input.privateKey !== undefined) {
    data.githubPrivateKeyEncrypted = input.privateKey.trim()
      ? encryptString(input.privateKey.trim())
      : null;
  }
  if (input.webhookSecret !== undefined) {
    data.githubWebhookSecretEncrypted = input.webhookSecret.trim()
      ? encryptString(input.webhookSecret.trim())
      : null;
  }
  if (input.clientId !== undefined) {
    data.githubClientId = input.clientId.trim() || null;
  }
  if (input.clientSecret !== undefined) {
    data.githubClientSecretEncrypted = input.clientSecret.trim()
      ? encryptString(input.clientSecret.trim())
      : null;
  }

  const row = await prisma.systemConfig.upsert({
    where: { key: SINGLETON_KEY },
    create: { key: SINGLETON_KEY, ...data },
    update: data,
    select: {
      githubAppId: true,
      githubAppSlug: true,
      githubPrivateKeyEncrypted: true,
      githubWebhookSecretEncrypted: true,
      githubClientId: true,
      githubClientSecretEncrypted: true,
      githubConfigured: true,
      updatedAt: true,
      updatedBy: true,
    },
  });

  const complete = !!(
  row.githubAppId &&
  row.githubAppSlug &&
  row.githubPrivateKeyEncrypted
);

  if (complete !== row.githubConfigured) {
    await prisma.systemConfig.update({
      where: { key: SINGLETON_KEY },
      data: { githubConfigured: complete },
    });
  }

  invalidateGithubConfigCache();

  logInfo("Configuration GitHub App mise à jour", {
    actorId,
    configured: complete,
  });

  return getGithubConfigPublic();
}

// ============================================================
// TEST CONNEXION
// ============================================================

export async function testGithubConfig(
  input: UpdateGithubConfigInput,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (!input.appId || !input.privateKey) {
      return {
        ok: false,
        message: "App ID et clé privée sont requis pour tester",
      };
    }

    const jwt = await import("jsonwebtoken");
    const now = Math.floor(Date.now() / 1000);

    // 1. Test : signer un JWT avec la clé privée
    let appJwt: string;
    try {
      appJwt = jwt.default.sign(
        { iat: now - 60, exp: now + 540, iss: input.appId },
        input.privateKey,
        { algorithm: "RS256" },
      );
    } catch {
      return {
        ok: false,
        message: "Clé privée invalide (format PEM attendu)",
      };
    }

    // 2. Test : appel /app pour vérifier l'App ID
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: appJwt });

    try {
      const response = await octokit.apps.getAuthenticated();
      const app = response.data;

      if (!app || !app.name) {
        return {
          ok: false,
          message:
            "Réponse GitHub vide ou incomplète — vérifie l'App ID et la clé privée",
        };
      }

      return {
        ok: true,
        message: `Connexion réussie : App "${app.name}" (ID ${app.id})`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Échec de l'authentification auprès de GitHub : ${msg}`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}