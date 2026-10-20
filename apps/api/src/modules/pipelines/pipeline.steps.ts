// apps/api/src/modules/pipelines/pipeline.steps.ts
import type { ProjectConfiguration } from "@prisma/client";

export interface StepDef {
  name: string;
  type: string;
  order: number;
  critical: boolean;
}

/**
 * Construit la liste des étapes d'un pipeline.
 *
 * Source unique de vérité, utilisée par le déclenchement manuel et par
 * les webhooks GitHub (push et pull_request). Les étapes sont ensuite
 * exécutées par le worker via `step.executor.ts`.
 */
export function buildDefaultSteps(config: ProjectConfiguration): StepDef[] {
  const steps: StepDef[] = [
    { name: "Checkout", type: "CHECKOUT", order: 1, critical: true },
    { name: "Technology Detection", type: "DETECTION", order: 2, critical: true },
    { name: "Install Dependencies", type: "INSTALL_DEPS", order: 3, critical: true },
    { name: "Tests", type: "TESTS", order: 4, critical: false },
  ];

  let order = 5;

  if (config.gitleaksEnabled) {
    steps.push({
      name: "Gitleaks",
      type: "SECRET_SCAN",
      order: order++,
      critical: false,
    });
  }
  if (config.semgrepEnabled) {
    steps.push({ name: "Semgrep", type: "SAST", order: order++, critical: false });
  }
  if (config.scaEnabled) {
    steps.push({ name: "SCA", type: "SCA", order: order++, critical: false });
  }
  if (config.iacEnabled) {
    steps.push({
      name: "Trivy config (IaC)",
      type: "IAC_SCAN",
      order: order++,
      critical: false,
    });
  }

  steps.push({
    name: "Docker Build",
    type: "DOCKER_BUILD",
    order: order++,
    critical: true,
  });

  if (config.cosignEnabled) {
    steps.push({
      name: "Cosign Sign",
      type: "SIGN",
      order: order++,
      critical: true,
    });
  }

  if (config.syftEnabled) {
    steps.push({
      name: "Syft SBOM",
      type: "SBOM",
      order: order++,
      critical: false,
    });
  }

  if (config.trivyEnabled) {
    steps.push({
      name: "Trivy image",
      type: "IMAGE_SCAN",
      order: order++,
      critical: false,
    });
  }

  steps.push({
    name: "Security Gate",
    type: "SECURITY_GATE",
    order: order++,
    critical: true,
  });

  const stagingStrategy = config.deploymentStrategy === "staging_then_production";

  steps.push({
    name: stagingStrategy ? "Deployment (staging)" : "Deployment",
    type: "DEPLOYMENT",
    order: order++,
    critical: false,
  });

  if (config.zapEnabled) {
    steps.push({
      name: "OWASP ZAP",
      type: "DAST",
      order: order++,
      critical: false,
    });
  }

  if (stagingStrategy) {
    // Deuxième gate : les résultats DAST doivent être évalués avant
    // toute promotion en production.
    steps.push({
      name: "Security Gate (post-DAST)",
      type: "SECURITY_GATE",
      order: order++,
      critical: true,
    });
    steps.push({
      name: "Promotion production",
      type: "PROMOTE",
      order: order++,
      critical: true,
    });
  }

  steps.push({
    name: "Final Report",
    type: "REPORT",
    order: order++,
    critical: false,
  });

  return steps;
}
