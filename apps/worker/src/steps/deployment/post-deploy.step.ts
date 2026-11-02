// apps/worker/src/steps/deployment/post-deploy.step.ts
import {
  DeploymentVerificationStatus,
  type Deployment,
  type DeploymentServer,
  type ProjectConfiguration,
} from "@prisma/client";
import { shellQuote } from "@devsecops/shared";
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import { SshRunner } from "../../runners/ssh.runner";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import { composeProjectName } from "./deploy.helper";
import { resolveProjectPorts } from "./ports";
import {
  evaluateDeploymentChecks,
  httpCheckPassed,
  imageDigestMatches,
  publishedPortsMatch,
  validateHealthcheckPath,
  type DeploymentCheck,
} from "./post-deploy.checks";

interface DeploymentWithServer extends Deployment {
  server: DeploymentServer;
}

function check(
  key: string,
  label: string,
  status: DeploymentCheck["status"],
  detail: string,
  values: { expected?: string; observed?: string; required?: boolean } = {},
): DeploymentCheck {
  return {
    key,
    label,
    status,
    detail,
    required: values.required ?? true,
    expected: values.expected,
    observed: values.observed,
  };
}

function environmentFor(deployment: Deployment): "STAGING" | "PRODUCTION" | null {
  if (
    deployment.environment === "STAGING" &&
    deployment.stagingStatus === "SUCCESS"
  ) {
    return "STAGING";
  }
  if (
    deployment.environment === "PRODUCTION" &&
    deployment.status === "SUCCESS"
  ) {
    return "PRODUCTION";
  }
  return null;
}

async function persistVerification(params: {
  deployment: DeploymentWithServer;
  pipelineId: string;
  projectId: string;
  environment: string;
  status: DeploymentVerificationStatus;
  checks: DeploymentCheck[];
  startedAt: number;
  error?: string | null;
}): Promise<void> {
  const finishedAt = new Date();
  const evaluation = evaluateDeploymentChecks(params.checks);
  await prisma.deploymentVerification.upsert({
    where: {
      deploymentId_environment: {
        deploymentId: params.deployment.id,
        environment: params.environment,
      },
    },
    create: {
      projectId: params.projectId,
      deploymentId: params.deployment.id,
      pipelineId: params.pipelineId,
      environment: params.environment,
      status: params.status,
      imageTag: params.deployment.imageTag,
      imageDigest: params.deployment.imageDigest,
      checksJson: params.checks as unknown as object,
      summaryJson: evaluation.summary as unknown as object,
      error: params.error ?? null,
      startedAt: new Date(params.startedAt),
      finishedAt,
      durationMs: Date.now() - params.startedAt,
    },
    update: {
      status: params.status,
      imageTag: params.deployment.imageTag,
      imageDigest: params.deployment.imageDigest,
      checksJson: params.checks as unknown as object,
      summaryJson: evaluation.summary as unknown as object,
      error: params.error ?? null,
      startedAt: new Date(params.startedAt),
      finishedAt,
      durationMs: Date.now() - params.startedAt,
    },
  });
}

/**
 * Contrôles déterministes APRÈS le déploiement.
 *
 * Ils constatent l'état réel sur la VM autorisée : conteneur, endpoint,
 * port publié, tag et digest. Un scan IaC ne peut pas produire ces preuves.
 * Aucune destination arbitraire : l'hôte vient du serveur de déploiement et
 * le port de la configuration du projet.
 */
export async function postDeploymentStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { server: true, config: true },
  });

  if (!project) {
    return { success: false, exitCode: 1, error: "Projet introuvable" };
  }
  if (!project.deploymentEnabled || !project.server) {
    await ctx.log(
      "info",
      "Déploiement désactivé ou serveur absent — vérification post-déploiement ignorée",
    );
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "deployment disabled" },
    };
  }

  const deployment = (await prisma.deployment.findUnique({
    where: { pipelineId: ctx.pipelineId },
    include: { server: true },
  })) as DeploymentWithServer | null;

  if (!deployment) {
    await ctx.log(
      "info",
      "Aucun déploiement pour ce pipeline — vérification post-déploiement ignorée",
    );
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "no deployment" },
    };
  }

  const environment = environmentFor(deployment);
  if (!environment) {
    await ctx.log(
      "info",
      "Déploiement non terminé — vérification post-déploiement ignorée",
    );
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "deployment not successful" },
    };
  }

  const startedAt = Date.now();

  if (project.config?.postDeployChecksEnabled === false) {
    const checks = [
      check(
        "policy",
        "Politique de vérification",
        "SKIPPED",
        "Les contrôles post-déploiement sont désactivés pour ce projet",
        { required: false },
      ),
    ];
    await persistVerification({
      deployment,
      pipelineId: ctx.pipelineId,
      projectId: ctx.projectId,
      environment,
      status: DeploymentVerificationStatus.SKIPPED,
      checks,
      startedAt,
    });
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, environment, reason: "post-deploy checks disabled" },
    };
  }

  const config: ProjectConfiguration | null = project.config;
  const server = deployment.server;

  if (!server.encryptedPrivateKey) {
    const checks = [
      check(
        "ssh",
        "Accès SSH au serveur",
        "FAILED",
        "Clé SSH du serveur absente : état réel non vérifiable",
      ),
    ];
    await persistVerification({
      deployment,
      pipelineId: ctx.pipelineId,
      projectId: ctx.projectId,
      environment,
      status: DeploymentVerificationStatus.FAILED,
      checks,
      startedAt,
      error: "Clé SSH absente",
    });
    return { success: false, exitCode: 1, error: "Clé SSH du serveur absente" };
  }

  let healthPath: string;
  try {
    healthPath = validateHealthcheckPath(config?.healthcheckPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, exitCode: 1, error: message };
  }

  const ports = await resolveProjectPorts(project.id, server.id);
  const expectedPort =
    environment === "STAGING" ? ports.stagingPort : ports.productionPort;
  const remoteDir = `/home/${server.username}/apps/${project.id}/${environment.toLowerCase()}`;
  const composeProject = composeProjectName(remoteDir);
  const baseUrl = `http://127.0.0.1:${expectedPort}`;
  const timeoutMs = Math.min(
    60_000,
    Math.max(1000, config?.healthcheckTimeoutMs ?? 5000),
  );
  const curlSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));

  let privateKey: string;
  try {
    privateKey = decryptString(server.encryptedPrivateKey);
  } catch {
    return {
      success: false,
      exitCode: 1,
      error: "Impossible de déchiffrer la clé SSH",
    };
  }
  const passphrase = server.encryptedPassphrase
    ? decryptString(server.encryptedPassphrase)
    : undefined;

  const ssh = new SshRunner();
  const checks: DeploymentCheck[] = [];

  try {
    await ctx.log(
      "info",
      `Vérification ${environment} sur ${server.name} (${server.host}:${server.sshPort}) — port ${expectedPort}`,
    );
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
      hostKeyFingerprint: server.hostKeyFingerprint,
    });

    const appContainerResult = await ssh.exec(
      `docker ps -a --filter ${shellQuote(`label=com.docker.compose.project=${composeProject}`)} ` +
        `--filter ${shellQuote("label=com.docker.compose.service=app")} --format '{{.ID}}'`,
      20_000,
    );
    const appContainerId = appContainerResult.stdout.trim().split(/\s+/u)[0] ?? "";
    const appRunning = appContainerId.length > 0;

    checks.push(
      check(
        "container_running",
        "Conteneur applicatif démarré",
        appRunning ? "PASSED" : "FAILED",
        appRunning
          ? `Conteneur ${appContainerId.slice(0, 12)} présent`
          : "Aucun conteneur applicatif trouvé pour ce projet",
        { expected: "running", observed: appRunning ? "running" : "missing" },
      ),
    );

    let appImageId = "";
    if (appRunning) {
      const inspect = await ssh.exec(
        `docker inspect --format '{{.State.Running}}|{{.Image}}|{{.Config.Image}}' ${shellQuote(appContainerId)}`,
        20_000,
      );
      const [running, imageId, imageTag] = inspect.stdout.trim().split("|");
      appImageId = (imageId ?? "").trim();
      const isRunning = (running ?? "").trim() === "true";

      checks.push(
        check(
          "container_state",
          "État du conteneur",
          isRunning ? "PASSED" : "FAILED",
          isRunning ? "Conteneur en cours d'exécution" : "Conteneur arrêté",
          { expected: "true", observed: running ?? "inconnu" },
        ),
      );
      checks.push(
        check(
          "image_tag",
          "Tag d'image exécuté",
          (imageTag ?? "").trim() === (deployment.imageTag ?? "")
            ? "PASSED"
            : "FAILED",
          `Tag observé : ${(imageTag ?? "").trim() || "inconnu"}`,
          {
            expected: deployment.imageTag ?? "inconnu",
            observed: (imageTag ?? "").trim() || "inconnu",
          },
        ),
      );
    }

    const digestOk = imageDigestMatches(appImageId, deployment.imageDigest);
    checks.push(
      check(
        "image_digest",
        "Digest de l'image exécutée",
        digestOk ? "PASSED" : "FAILED",
        digestOk
          ? "Le conteneur exécute exactement l'artefact validé"
          : "Le conteneur ne correspond pas au digest validé",
        {
          expected: deployment.imageDigest ?? "absent",
          observed: appImageId || "absent",
        },
      ),
    );

    if (deployment.imageTag) {
      const tagInspect = await ssh.exec(
        `docker image inspect --format '{{.Id}}' ${shellQuote(deployment.imageTag)} 2>/dev/null`,
        20_000,
      );
      const tagDigest = tagInspect.stdout.trim();
      checks.push(
        check(
          "tag_integrity",
          "Intégrité du tag déployé",
          imageDigestMatches(tagDigest, deployment.imageDigest)
            ? "PASSED"
            : "FAILED",
          "Le tag ne doit pas avoir été réaffecté à une autre image",
          {
            expected: deployment.imageDigest ?? "absent",
            observed: tagDigest || "introuvable",
          },
        ),
      );
    }

    const nginxResult = await ssh.exec(
      `docker ps --filter ${shellQuote(`label=com.docker.compose.project=${composeProject}`)} ` +
        `--filter ${shellQuote("label=com.docker.compose.service=nginx")} --format '{{.ID}}'`,
      20_000,
    );
    const nginxContainerId = nginxResult.stdout.trim().split(/\s+/u)[0] ?? "";
    if (!nginxContainerId) {
      checks.push(
        check(
          "published_port",
          "Port publié conforme",
          "FAILED",
          "Conteneur nginx introuvable : port non vérifiable",
        ),
      );
    } else {
      const portResult = await ssh.exec(
        `docker port ${shellQuote(nginxContainerId)} 80/tcp`,
        20_000,
      );
      const mapping = publishedPortsMatch(portResult.stdout, expectedPort);
      checks.push(
        check(
          "published_port",
          "Port publié conforme",
          mapping.ok ? "PASSED" : "FAILED",
          mapping.ok
            ? `Port ${expectedPort} uniquement`
            : "Le port publié diffère de la configuration autorisée",
          {
            expected: String(expectedPort),
            observed: mapping.ports.join(", ") || "aucun",
          },
        ),
      );
    }

    const health = await ssh.exec(
      `curl -sS -o /dev/null -w "%{http_code}" --max-time ${curlSeconds} ` +
        `${shellQuote(`${baseUrl}${healthPath}`)} 2>/dev/null || echo FAILED`,
      timeoutMs + 5000,
    );
    const healthCode = health.stdout.trim();
    checks.push(
      check(
        "health_endpoint",
        "Healthcheck applicatif",
        httpCheckPassed(healthCode) ? "PASSED" : "FAILED",
        httpCheckPassed(healthCode)
          ? `HTTP ${healthCode} sur ${healthPath}`
          : `Réponse inattendue (${healthCode || "aucune"}) sur ${healthPath}`,
        { expected: "2xx/3xx", observed: healthCode || "aucune" },
      ),
    );

    const root = await ssh.exec(
      `curl -sS -o /dev/null -w "%{http_code}" --max-time ${curlSeconds} ` +
        `${shellQuote(`${baseUrl}/`)} 2>/dev/null || echo FAILED`,
      timeoutMs + 5000,
    );
    const rootCode = root.stdout.trim();
    checks.push(
      check(
        "root_endpoint",
        "Endpoint applicatif /",
        httpCheckPassed(rootCode) ? "PASSED" : "FAILED",
        httpCheckPassed(rootCode)
          ? `HTTP ${rootCode} sur /`
          : `Réponse inattendue (${rootCode || "aucune"}) sur /`,
        { expected: "2xx/3xx", observed: rootCode || "aucune" },
      ),
    );

    const evaluation = evaluateDeploymentChecks(checks);
    const verificationStatus =
      evaluation.status === "PASSED"
        ? DeploymentVerificationStatus.PASSED
        : DeploymentVerificationStatus.FAILED;

    await persistVerification({
      deployment,
      pipelineId: ctx.pipelineId,
      projectId: ctx.projectId,
      environment,
      status: verificationStatus,
      checks,
      startedAt,
    });

    for (const item of checks) {
      await ctx.log(
        item.status === "PASSED" ? "info" : "warn",
        `${item.status} ${item.label} — ${item.detail}`,
      );
    }

    await prisma.auditLog.create({
      data: {
        userId: project.ownerId,
        action:
          evaluation.status === "PASSED"
            ? "DEPLOYMENT_VERIFIED"
            : "DEPLOYMENT_VERIFICATION_FAILED",
        targetType: "Deployment",
        targetId: deployment.id,
        metadataJson: {
          environment,
          verificationStatus,
          checks: checks.map((item) => ({
            key: item.key,
            status: item.status,
          })),
        },
      },
    });

    if (evaluation.status !== "PASSED") {
      const failed = checks
        .filter((item) => item.required && item.status !== "PASSED")
        .map((item) => item.label)
        .join(", ");
      return {
        success: false,
        exitCode: 1,
        error: `Conformité post-déploiement échouée : ${failed}`,
        data: {
          environment,
          verificationStatus,
          checks,
          severityCounts: evaluation.summary,
        },
      };
    }

    return {
      success: true,
      exitCode: 0,
      data: {
        environment,
        verificationStatus,
        checks,
        summary: evaluation.summary,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Vérification post-déploiement impossible : ${message}`);

    checks.push(
      check(
        "verification_error",
        "Exécution des contrôles",
        "FAILED",
        message.slice(0, 1000),
      ),
    );
    await persistVerification({
      deployment,
      pipelineId: ctx.pipelineId,
      projectId: ctx.projectId,
      environment,
      status: DeploymentVerificationStatus.FAILED,
      checks,
      startedAt,
      error: message,
    }).catch(() => undefined);

    return {
      success: false,
      exitCode: 1,
      error: `Vérification post-déploiement impossible : ${message}`,
      data: { environment, checks },
    };
  } finally {
    await ssh.disconnect().catch(() => undefined);
  }
}
