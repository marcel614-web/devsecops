// apps/api/src/modules/pipelines/pipeline.steps.ts
import type { ProjectConfiguration } from "@prisma/client";

export interface StepDef {
  name: string;
  type: string;
  order: number;
  critical: boolean;
}

export interface BuildStepsOptions {
  /**
   * Pipeline de Pull Request : il valide le code et publie un Check Run,
   * mais ne déploie jamais. Seuls les pipelines de branche surveillée
   * (push) ou manuels peuvent atteindre le déploiement.
   */
  pullRequest?: boolean;
}

/**
 * Construit la liste des étapes d'un pipeline.
 *
 * Source unique de vérité, utilisée par le déclenchement manuel et par
 * les webhooks GitHub (push et pull_request). Les étapes sont ensuite
 * exécutées par le worker via `step.executor.ts`.
 */
export function buildDefaultSteps(
  config: ProjectConfiguration,
  options: BuildStepsOptions = {},
): StepDef[] {
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
      name: "IaC & Ansible",
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

  if (config.cosignMode && config.cosignMode !== "DISABLED") {
    steps.push({
      name: "Cosign Sign",
      type: "SIGN",
      order: order++,
      critical: config.cosignMode === "REQUIRED",
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

  // Une Pull Request ne déploie jamais, même si le projet est configuré
  // pour un déploiement direct. Le pipeline PR sert à valider le commit et
  // à publier le Check Run ; la promotion reste réservée au push sur la
  // branche surveillée (ou à un déclenchement manuel explicite).
  if (!options.pullRequest) {
    const stagingStrategy =
      config.deploymentStrategy === "staging_then_production";

    steps.push({
      name: stagingStrategy ? "Deployment (staging)" : "Deployment",
      type: "DEPLOYMENT",
      order: order++,
      // Un échec de déploiement doit arrêter le pipeline : sans cela, une
      // production non déployée pourrait être présentée comme un simple
      // avertissement.
      critical: true,
    });

    if (config.postDeployChecksEnabled !== false) {
      steps.push({
        name: stagingStrategy
          ? "Post-déploiement (staging)"
          : "Post-déploiement (production)",
        type: "POST_DEPLOY",
        order: order++,
        // Le déploiement peut réussir puis régresser (conteneur arrêté,
        // digest remplacé). Ce constat doit interrompre le pipeline.
        critical: true,
      });
    }

    if (config.zapEnabled) {
      steps.push({
        name: "OWASP ZAP",
        type: "DAST",
        order: order++,
        critical: false,
      });
    }

    if (config.zapEnabled) {
      // Deuxième gate : les résultats DAST doivent être évalués après ZAP.
      // En stratégie staging, il bloque la promotion en production ; en
      // déploiement direct, il force une décision de sécurité finale visible
      // avant le rapport (même si le déploiement a déjà eu lieu).
      steps.push({
        name: "Security Gate (post-DAST)",
        type: "SECURITY_GATE",
        order: order++,
        critical: true,
      });
    }

    if (stagingStrategy) {
      if (config.requireProductionApproval) {
        steps.push({
          name: "Approbation production",
          type: "APPROVAL",
          order: order++,
          critical: true,
        });
      }
      steps.push({
        name: "Promotion production",
        type: "PROMOTE",
        order: order++,
        critical: true,
      });
      if (config.postDeployChecksEnabled !== false) {
        steps.push({
          name: "Post-déploiement (production)",
          type: "POST_DEPLOY",
          order: order++,
          critical: true,
        });
      }
    }
  }

  steps.push({
    name: "Final Report",
    type: "REPORT",
    order: order++,
    critical: false,
  });

  if (config.defectDojoEnabled) {
    steps.push({
      name: "DefectDojo Export",
      type: "DEFECTDOJO_EXPORT",
      order: order++,
      critical: false,
    });
  }

  return steps;
}
