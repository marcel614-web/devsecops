// apps/api/src/modules/dependency-track/dependency-track.service.ts
import { prisma } from "../../utils/prisma";
import { encryptString, decryptString } from "../../secrets/crypto";
import { logger } from "../../utils/logger";

const SINGLETON_KEY = "default";

export interface DependencyTrackConfigInput {
  url?: string;
  apiKey?: string;
}

export interface DependencyTrackConfigPublic {
  configured: boolean;
  url: string | null;
  hasApiKey: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface InternalConfig {
  url: string;
  apiKey: string;
}

async function loadConfig(): Promise<InternalConfig | null> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: SINGLETON_KEY },
    select: {
      dependencyTrackConfigured: true,
      dependencyTrackUrl: true,
      dependencyTrackApiKeyEncrypted: true,
    },
  });
  if (!row?.dependencyTrackConfigured || !row.dependencyTrackUrl || !row.dependencyTrackApiKeyEncrypted) {
    return null;
  }
  try {
    return {
      url: row.dependencyTrackUrl.replace(/\/+$/, ""),
      apiKey: decryptString(row.dependencyTrackApiKeyEncrypted),
    };
  } catch (err) {
    logger.warn({ err }, "Dependency-Track : clé illisible");
    return null;
  }
}

export async function getDependencyTrackConfigPublic(): Promise<DependencyTrackConfigPublic> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: SINGLETON_KEY },
    select: {
      dependencyTrackConfigured: true,
      dependencyTrackUrl: true,
      dependencyTrackApiKeyEncrypted: true,
      updatedAt: true,
      updatedBy: true,
    },
  });
  return {
    configured: !!row?.dependencyTrackConfigured,
    url: row?.dependencyTrackUrl ?? null,
    hasApiKey: !!row?.dependencyTrackApiKeyEncrypted,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export async function updateDependencyTrackConfig(
  input: DependencyTrackConfigInput,
  actorId: string,
): Promise<DependencyTrackConfigPublic> {
  const data: Record<string, unknown> = {};
  if (input.url !== undefined) data.dependencyTrackUrl = input.url.trim() || null;
  if (input.apiKey !== undefined) {
    const trimmed = input.apiKey.trim();
    data.dependencyTrackApiKeyEncrypted = trimmed ? encryptString(trimmed) : null;
  }

  const existing = await prisma.systemConfig.findUnique({
    where: { key: SINGLETON_KEY },
    select: { dependencyTrackUrl: true, dependencyTrackApiKeyEncrypted: true },
  });

  const url = (data.dependencyTrackUrl as string | null | undefined) ?? existing?.dependencyTrackUrl ?? null;
  const key = (data.dependencyTrackApiKeyEncrypted as string | null | undefined) ?? existing?.dependencyTrackApiKeyEncrypted ?? null;
  data.dependencyTrackConfigured = !!url && !!key;

  await prisma.systemConfig.upsert({
    where: { key: SINGLETON_KEY },
    create: { key: SINGLETON_KEY, ...data },
    update: data,
  });
  await prisma.systemConfig.update({
    where: { key: SINGLETON_KEY },
    data: { updatedBy: actorId },
  });

  logger.info({ actorId, configured: data.dependencyTrackConfigured }, "Configuration Dependency-Track mise a jour");
  return getDependencyTrackConfigPublic();
}

export async function testDependencyTrackConnection(
  input: DependencyTrackConfigInput,
): Promise<{ ok: boolean; message: string }> {
  const url = input.url?.trim();
  const apiKey = input.apiKey?.trim();
  let config: InternalConfig | null = null;
  if (url && apiKey) {
    config = { url: url.replace(/\/+$/, ""), apiKey };
  } else {
    config = await loadConfig();
  }
  if (!config) return { ok: false, message: "URL et clé API sont requis" };

  try {
    const response = await fetch(`${config.url}/api/v1/project?limit=1`, {
      headers: { "X-Api-Key": config.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { ok: false, message: `Dependency-Track a répondu HTTP ${response.status}` };
    }
    return { ok: true, message: "Connexion Dependency-Track réussie" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Erreur réseau" };
  }
}

export async function uploadSbomToDependencyTrack(params: {
  projectId: string;
  pipelineId: string;
  projectName: string;
  projectVersion: string;
}): Promise<{ status: "SUCCESS" | "FAILED"; error?: string }> {
  const config = await loadConfig();
  if (!config) {
    return { status: "FAILED", error: "Dependency-Track non configuré" };
  }

  const sbom = await prisma.sbom.findUnique({
    where: { pipelineId: params.pipelineId },
    select: { contentJson: true, format: true },
  });
  if (!sbom) {
    return { status: "FAILED", error: "SBOM introuvable pour ce pipeline" };
  }

  const form = new FormData();
  form.append("projectName", params.projectName);
  form.append("projectVersion", params.projectVersion);
  form.append("autoCreate", "true");
  form.append(
    "bom",
    new Blob([JSON.stringify(sbom.contentJson)], { type: "application/json" }),
    "sbom.json",
  );

  try {
    const response = await fetch(`${config.url}/api/v1/bom`, {
      method: "POST",
      headers: { "X-Api-Key": config.apiKey },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      return { status: "FAILED", error: `HTTP ${response.status}` };
    }
    return { status: "SUCCESS" };
  } catch (err) {
    return { status: "FAILED", error: err instanceof Error ? err.message : "Erreur réseau" };
  }
}