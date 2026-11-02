// apps/worker/src/steps/deployment/post-deploy.checks.test.ts
import { describe, expect, it } from "vitest";
import {
  evaluateDeploymentChecks,
  imageDigestMatches,
  parsePublishedPorts,
  publishedPortsMatch,
  validateHealthcheckPath,
} from "./post-deploy.checks";

describe("validateHealthcheckPath", () => {
  it("accepte un chemin local", () => {
    expect(validateHealthcheckPath("/health")).toBe("/health");
    expect(validateHealthcheckPath(null)).toBe("/");
  });

  it("rejette une destination arbitraire", () => {
    expect(() => validateHealthcheckPath("http://evil.example/")).toThrow();
    expect(() => validateHealthcheckPath("/a/../b")).toThrow();
    expect(() => validateHealthcheckPath("/a\\b")).toThrow();
  });
});

describe("parsePublishedPorts", () => {
  it("extrait les ports publiés", () => {
    expect(parsePublishedPorts("0.0.0.0:8080\n:::8080")).toEqual([8080]);
  });

  it("retourne vide si aucune liaison", () => {
    expect(parsePublishedPorts("")).toEqual([]);
  });
});

describe("publishedPortsMatch", () => {
  it("valide le port autorisé", () => {
    expect(publishedPortsMatch("0.0.0.0:8080", 8080)).toEqual({
      ok: true,
      ports: [8080],
    });
  });

  it("refuse un port inattendu", () => {
    expect(publishedPortsMatch("0.0.0.0:9090", 8080)).toEqual({
      ok: false,
      ports: [9090],
    });
  });
});

describe("imageDigestMatches", () => {
  it("compare le digest attendu", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(imageDigestMatches(digest, digest)).toBe(true);
    expect(imageDigestMatches(`sha256:${"b".repeat(64)}`, digest)).toBe(false);
    expect(imageDigestMatches("sha256:abc", digest)).toBe(false);
  });
});

describe("evaluateDeploymentChecks", () => {
  it("échoue si un contrôle requis échoue", () => {
    const result = evaluateDeploymentChecks([
      {
        key: "container",
        label: "Conteneur",
        status: "FAILED",
        required: true,
        detail: "arrêté",
      },
      {
        key: "port",
        label: "Port",
        status: "PASSED",
        required: true,
        detail: "ok",
      },
    ]);
    expect(result.status).toBe("FAILED");
    expect(result.summary.failed).toBe(1);
  });

  it("passe si tous les contrôles requis passent", () => {
    const result = evaluateDeploymentChecks([
      {
        key: "container",
        label: "Conteneur",
        status: "PASSED",
        required: true,
        detail: "ok",
      },
    ]);
    expect(result.status).toBe("PASSED");
  });
});