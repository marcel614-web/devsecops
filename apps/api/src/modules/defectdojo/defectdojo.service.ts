// apps/api/src/modules/defectdojo/defectdojo.service.ts
import { prisma } from "../../utils/prisma";
import { encryptString, decryptString } from "../../secrets/crypto";
import { logger } from "../../utils/logger";

const SINGLETON_KEY = "default";

export interface DefectDojoConfigInput {
  url?: string;
  apiToken?: string;
}

export interface DefectDojoConfigPublic {
  configured: boolean;
  url: string | null;
  hasApiToken: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface DefectDojoConfigInternal {
  url: string;
  apiToken: string;
}

async function loadConfig(): Promise<DefectDojoConfigInternal | null> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: SINGLETON_KEY },
    select: {
      defectDojoConfigured: true,
      defectDojoUrl: true,
      defectDojoApiTokenEncrypted: true,
    },
  });
  if (!row?.defectDojoConfigured || !row.defectDojoUrl || !row.defectDojoApiTokenEncrypted) {
    return null;
  }
  try {
    return {
      url: row.defectDojoUrl.replace(/\/+$/, ""),
      apiToken: decryptString(row.defectDojoApiTokenEncrypted),
    };
  } catch (err) {
    logger.warn({ err }, "DefectDojo : jeton illisible");
    return null;
  }
}

export async function getDefectDojoConfigPublic(): Promise<DefectDojoConfigPublic> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: SINGLETON_KEY },
    select: {
      defectDojoConfigured: true,
      defectDojoUrl: true,
      defectDojoApiTokenEncrypted: true,
      updatedAt: true,
      updatedBy: true,
    },
  });
  return {
    configured: !!row?.defectDojoConfigured,
    url: row?.defectDojoUrl ?? null,
    hasApiToken: !!row?.defectDojoApiTokenEncrypted,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export async function updateDefectDojoConfig(
  input: DefectDojoConfigInput,
  actorId: string,
): Promise<DefectDojoConfigPublic> {
  const data: Record<string, unknown> = {};
  if (input.url !== undefined) {
    const trimmed = input.url.trim();
    data.defectDojoUrl = trimmed || null;
  }
  if (input.apiToken !== undefined) {
    const trimmed = input.apiToken.trim();
    data.defectDojoApiTokenEncrypted = trimmed ? encryptString(trimmed) : null;
  }

  const existing = await prisma.systemConfig.findUnique({
    where: { key: SINGLETON_KEY },
    select: { defectDojoUrl: true, defectDojoApiTokenEncrypted: true },
  });

  const url = (data.defectDojoUrl as string | null | undefined) ?? existing?.defectDojoUrl ?? null;
  const token =
    (data.defectDojoApiTokenEncrypted as string | null | undefined) ??
    existing?.defectDojoApiTokenEncrypted ??
    null;
  const complete = !!url && !!token;
  data.defectDojoConfigured = complete;

  await prisma.systemConfig.upsert({
    where: { key: SINGLETON_KEY },
    create: { key: SINGLETON_KEY, ...data },
    update: data,
  });

  await prisma.systemConfig.update({
    where: { key: SINGLETON_KEY },
    data: { updatedBy: actorId },
  });

  logger.info({ actorId, configured: complete }, "Configuration DefectDojo mise a jour");
  return getDefectDojoConfigPublic();
}

export async function testDefectDojoConnection(
  input: DefectDojoConfigInput,
): Promise<{ ok: boolean; message: string }> {
  const config = await resolveConfigForTest(input);
  if (!config) {
    return { ok: false, message: "URL et jeton API sont requis" };
  }
  try {
    const response = await fetch(`${config.url}/api/v2/users/?limit=1`, {
      headers: { Authorization: `Token ${config.apiToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        message: `DefectDojo a repondu HTTP ${response.status}`,
      };
    }
    return { ok: true, message: "Connexion DefectDojo reussie" };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Erreur reseau",
    };
  }
}

async function resolveConfigForTest(
  input: DefectDojoConfigInput,
): Promise<DefectDojoConfigInternal | null> {
  const url = input.url?.trim();
  const token = input.apiToken?.trim();
  if (url && token) {
    return { url: url.replace(/\/+$/, ""), apiToken: token };
  }
  const stored = await loadConfig();
  if (!stored) return null;
  return {
    url: url ? url.replace(/\/+$/, "") : stored.url,
    apiToken: token || stored.apiToken,
  };
}

export async function syncPipelineToDefectDojo(params: {
  projectId: string;
  pipelineId: string;
  engagementId: number;
}): Promise<{ status: "SUCCESS" | "FAILED"; externalId?: string; error?: string }> {
  const config = await loadConfig();
  if (!config) {
    const error = "DefectDojo non configure";
    await recordImport(params, "FAILED", null, error);
    return { status: "FAILED", error };
  }

  const vulnerabilities = await prisma.vulnerability.findMany({
    where: { scan: { pipelineId: params.pipelineId } },
    select: {
      tool: true,
      severity: true,
      packageName: true,
      filePath: true,
      description: true,
      reference: true,
    },
  });

  const findings = vulnerabilities.map((v) => ({
    title: v.description ?? v.reference ?? "Finding",
    description: v.description ?? "",
    severity: v.severity,
    file_path: v.filePath ?? undefined,
    cve: v.reference ?? undefined,
    component_name: v.packageName ?? undefined,
  }));

  const payload = {
    title: `Pipeline ${params.pipelineId}`,
    findings,
  };

  const form = new FormData();
  form.append("scan_type", "Generic Findings Import");
  form.append("engagement", String(params.engagementId));
  form.append(
    "file",
    new Blob([JSON.stringify(payload)], { type: "application/json" }),
    "findings.json",
  );

  try {
    const response = await fetch(`${config.url}/api/v2/import-scan/`, {
      method: "POST",
      headers: { Authorization: `Token ${config.apiToken}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string | number };
    if (!response.ok) {
      const error = `HTTP ${response.status}`;
      await recordImport(params, "FAILED", null, error);
      return { status: "FAILED", error };
    }
    const externalId = body?.id ? String(body.id) : undefined;
    await recordImport(params, "SUCCESS", externalId ?? null, null);
    return { status: "SUCCESS", externalId };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Erreur reseau";
    await recordImport(params, "FAILED", null, error);
    return { status: "FAILED", error };
  }
}

async function recordImport(
  params: { projectId: string; pipelineId: string; engagementId: number },
  status: "SUCCESS" | "FAILED",
  externalId: string | null,
  error: string | null,
): Promise<void> {
  try {
    await prisma.defectDojoImport.create({
      data: {
        projectId: params.projectId,
        pipelineId: params.pipelineId,
        engagementId: params.engagementId,
        status,
        externalId,
        error,
      },
    });
  } catch (err) {
    logger.warn({ err }, "DefectDojo : impossible d'enregistrer l'import");
  }
}

export async function listDefectDojoImports(projectId: string) {
  return prisma.defectDojoImport.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}