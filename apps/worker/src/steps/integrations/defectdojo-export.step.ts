// apps/worker/src/steps/integrations/defectdojo-export.step.ts
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

export async function defectDojoExportStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const startedAt = Date.now();
  const config = await prisma.projectConfiguration.findUnique({
    where: { projectId: ctx.projectId },
    select: {
      defectDojoEnabled: true,
      defectDojoEngagementId: true,
    },
  });

  if (!config?.defectDojoEnabled || !config.defectDojoEngagementId) {
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "DefectDojo désactivé ou engagement non sélectionné" },
    };
  }

  const systemConfig = await prisma.systemConfig.findUnique({
    where: { key: "default" },
    select: {
      defectDojoConfigured: true,
      defectDojoUrl: true,
      defectDojoApiTokenEncrypted: true,
    },
  });

  if (!systemConfig?.defectDojoConfigured || !systemConfig.defectDojoUrl || !systemConfig.defectDojoApiTokenEncrypted) {
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "DefectDojo non configuré" },
    };
  }

  let apiToken: string;
  try {
    apiToken = decryptString(systemConfig.defectDojoApiTokenEncrypted);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Jeton illisible";
    await ctx.log("warn", `DefectDojo : ${message}`);
    return { success: true, exitCode: 0, data: { skipped: true, reason: message } };
  }

  const vulnerabilities = await prisma.vulnerability.findMany({
    where: { scan: { pipelineId: ctx.pipelineId } },
    select: {
      description: true,
      reference: true,
      severity: true,
      filePath: true,
      packageName: true,
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

  const form = new FormData();
  form.append("scan_type", "Generic Findings Import");
  form.append("engagement", String(config.defectDojoEngagementId));
  form.append(
    "file",
    new Blob([JSON.stringify({ title: `Pipeline ${ctx.pipelineId}`, findings })], {
      type: "application/json",
    }),
    "findings.json",
  );

  try {
    const response = await fetch(`${systemConfig.defectDojoUrl.replace(/\/+$/, "")}/api/v2/import-scan/`, {
      method: "POST",
      headers: { Authorization: `Token ${apiToken}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string | number };

    await prisma.defectDojoImport.create({
      data: {
        projectId: ctx.projectId,
        pipelineId: ctx.pipelineId,
        engagementId: config.defectDojoEngagementId,
        status: response.ok ? "SUCCESS" : "FAILED",
        externalId: body?.id ? String(body.id) : null,
        error: response.ok ? null : `HTTP ${response.status}`,
      },
    });

    if (!response.ok) {
      await ctx.log("warn", `DefectDojo : import échoué (HTTP ${response.status})`);
    } else {
      await ctx.log("info", `DefectDojo : import réussi (${body?.id ?? "sans id"})`);
    }

    return {
      success: true,
      exitCode: 0,
      data: {
        defectDojo: response.ok ? "SUCCESS" : "FAILED",
        externalId: body?.id ? String(body.id) : null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur réseau";
    await prisma.defectDojoImport
      .create({
        data: {
          projectId: ctx.projectId,
          pipelineId: ctx.pipelineId,
          engagementId: config.defectDojoEngagementId,
          status: "FAILED",
          error: message,
        },
      })
      .catch(() => undefined);
    await ctx.log("warn", `DefectDojo : ${message}`);
    return { success: true, exitCode: 0, data: { defectDojo: "FAILED", error: message } };
  } finally {
    void startedAt;
  }
}