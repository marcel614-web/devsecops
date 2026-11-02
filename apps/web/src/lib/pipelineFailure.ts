// apps/web/src/lib/pipelineFailure.ts
import type { PipelineDetail, PipelineStep } from "@/types/api";

export interface FailureInfo {
  stepName: string;
  stepType: string;
  error: string;
  hint: string | null;
  severity: "failed" | "blocked";
}

/**
 * Analyse un pipeline et retourne la cause d'arrêt (si applicable).
 * Priorité : étape SECURITY_BLOCKED > étape FAILED > statut global.
 */
export function getPipelineFailure(pipeline: PipelineDetail): FailureInfo | null {
  // 1. Security Gate bloqué
  if (pipeline.status === "SECURITY_BLOCKED" && pipeline.gateResult) {
    return {
      stepName: "Security Gate",
      stepType: "SECURITY_GATE",
      error: pipeline.gateResult.reason ?? "Seuils de sécurité dépassés",
      hint: "Réduis les vulnérabilités détectées, ajoute une exception ciblée justifiée, ou ajuste la politique dans Configuration du projet.",
      severity: "blocked",
    };
  }

  // 2. Chercher la première étape qui n'est pas SUCCESS
  const failingStep = pipeline.steps.find(
    (s) =>
      s.status === "FAILED" ||
      s.status === "SECURITY_BLOCKED" ||
      s.status === "TIMED_OUT",
  );

  if (!failingStep) {
    // 3. Statut global FAILED/TIMED_OUT mais aucune étape ne matche → fallback
    if (pipeline.status === "FAILED") {
      return {
        stepName: "Pipeline",
        stepType: "UNKNOWN",
        error: "Échec du pipeline (raison non détaillée)",
        hint: "Consulte les logs pour identifier l'étape en cause.",
        severity: "failed",
      };
    }
    if (pipeline.status === "TIMED_OUT") {
      return {
        stepName: "Pipeline",
        stepType: "UNKNOWN",
        error: "Le pipeline a dépassé un délai maximal",
        hint: "Consulte les logs et les délais des étapes.",
        severity: "failed",
      };
    }
    return null;
  }

  return {
    stepName: failingStep.name,
    stepType: failingStep.type,
    error: failingStep.error ?? "Étape échouée",
    hint: getHintForStep(failingStep),
    severity: failingStep.status === "SECURITY_BLOCKED" ? "blocked" : "failed",
  };
}

/**
 * Fournit un hint de correction contextuel selon le type d'étape.
 */
function getHintForStep(step: PipelineStep): string | null {
  const err = (step.error ?? "").toLowerCase();

  // Docker Build : pas de serveur associé
  if (step.type === "DOCKER_BUILD") {
    if (err.includes("aucun serveur") || err.includes("no server")) {
      return "Associe un serveur de déploiement au projet (Onglet Configuration → Serveur de déploiement).";
    }
    if (err.includes("docker") || err.includes("ssh")) {
      return "Vérifie que Docker est installé et accessible sur le serveur, et que la clé SSH est valide.";
    }
    if (err.includes("dockerfile")) {
      return "Ajoute un Dockerfile à la racine du repo, ou vérifie que la génération automatique est possible.";
    }
  }

  // Checkout
  if (step.type === "CHECKOUT") {
    if (err.includes("repository not found") || err.includes("404")) {
      return "Vérifie que le repository existe et que la GitHub App y a accès.";
    }
    if (err.includes("could not read") || err.includes("auth")) {
      return "Vérifie que la GitHub App est installée et que le token d'installation est valide.";
    }
    if (err.includes("branch")) {
      return "La branche configurée n'existe pas sur le repo. Vérifie le nom de la branche.";
    }
  }

  // Tests
  if (step.type === "TESTS") {
    return "Corrige les tests qui échouent dans ton repo, ou ajuste la commande de test.";
  }

  // Trivy
  if (step.type === "IMAGE_SCAN") {
    if (err.includes("no docker image")) {
      return "L'étape Docker Build doit réussir avant que Trivy puisse scanner l'image.";
    }
    return "Vérifie que l'image Trivy peut être téléchargée depuis le serveur.";
  }

  // Deployment
  if (step.type === "DEPLOYMENT") {
    if (err.includes("ssh")) {
      return "Vérifie l'accès SSH au serveur (clé, utilisateur, port).";
    }
    if (err.includes("compose")) {
      return "Vérifie que Docker Compose est installé sur le serveur.";
    }
    if (err.includes("healthcheck")) {
      return "L'application n'a pas répondu sur le port attendu. Vérifie qu'elle écoute sur le bon port.";
    }
    return "Consulte les logs du serveur pour plus de détails.";
  }

  // Semgrep / Gitleaks / SCA : rarement bloquants
  if (
    step.type === "SECRET_SCAN" ||
    step.type === "SAST" ||
    step.type === "SCA"
  ) {
    return "Vérifie les logs. Le Security Gate peut bloquer après ces analyses selon la politique du pipeline.";
  }

  // Security Gate
  if (step.type === "SECURITY_GATE") {
    return "Réduis les vulnérabilités ou augmente les seuils du Security Gate dans Configuration.";
  }

  return null;
}