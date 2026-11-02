// apps/api/src/modules/pipelines/pipeline.steps.test.ts
import type { ProjectConfiguration } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildDefaultSteps } from "./pipeline.steps";

function config(overrides: Partial<ProjectConfiguration> = {}): ProjectConfiguration {
  return {
    gitleaksEnabled: true,
    semgrepEnabled: true,
    scaEnabled: true,
    iacEnabled: true,
    trivyEnabled: true,
    syftEnabled: true,
    zapEnabled: false,
    cosignEnabled: false,
    deploymentStrategy: "direct",
    ...overrides,
  } as ProjectConfiguration;
}

function indexOf(steps: ReturnType<typeof buildDefaultSteps>, type: string) {
  return steps.findIndex((step) => step.type === type);
}

describe("ordre des Security Gates", () => {
  it("évalue le gate avant le déploiement puis après ZAP", () => {
    const steps = buildDefaultSteps(
      config({
        zapEnabled: true,
        deploymentStrategy: "staging_then_production",
      }),
    );

    const gates = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.type === "SECURITY_GATE");
    expect(gates.map(({ step }) => step.name)).toEqual([
      "Security Gate",
      "Security Gate (post-DAST)",
    ]);
    expect(gates[0]!.index).toBeLessThan(indexOf(steps, "DEPLOYMENT"));
    expect(indexOf(steps, "DAST")).toBeLessThan(gates[1]!.index);
    expect(gates[1]!.index).toBeLessThan(indexOf(steps, "PROMOTE"));
  });

  it("ajoute aussi un gate post-DAST en déploiement direct", () => {
    const steps = buildDefaultSteps(config({ zapEnabled: true }));

    expect(indexOf(steps, "DAST")).toBeLessThan(
      steps.findIndex(
        (step) =>
          step.type === "SECURITY_GATE" &&
          step.name === "Security Gate (post-DAST)",
      ),
    );
  });

  it("ne duplique pas le gate lorsqu'aucun DAST n'est planifié", () => {
    const steps = buildDefaultSteps(
      config({
        zapEnabled: false,
        deploymentStrategy: "staging_then_production",
      }),
    );

    expect(steps.filter((step) => step.type === "SECURITY_GATE")).toHaveLength(
      1,
    );
    expect(indexOf(steps, "PROMOTE")).toBeGreaterThan(
      indexOf(steps, "DEPLOYMENT"),
    );
  });
});

describe("pipeline de Pull Request", () => {
  it("ne planifie jamais de déploiement, de DAST ni de promotion", () => {
    const steps = buildDefaultSteps(
      config({
        zapEnabled: true,
        deploymentStrategy: "staging_then_production",
        requireProductionApproval: true,
      } as Partial<ProjectConfiguration>),
      { pullRequest: true },
    );

    expect(indexOf(steps, "DEPLOYMENT")).toBe(-1);
    expect(indexOf(steps, "DAST")).toBe(-1);
    expect(indexOf(steps, "PROMOTE")).toBe(-1);
    expect(indexOf(steps, "APPROVAL")).toBe(-1);
    expect(indexOf(steps, "SECURITY_GATE")).toBeGreaterThan(-1);
    expect(indexOf(steps, "REPORT")).toBeGreaterThan(-1);
  });

  it("conserve le déploiement pour un pipeline de branche", () => {
    const steps = buildDefaultSteps(
      config({ deploymentStrategy: "staging_then_production" }),
    );

    expect(indexOf(steps, "DEPLOYMENT")).toBeGreaterThan(-1);
    expect(indexOf(steps, "PROMOTE")).toBeGreaterThan(-1);
    expect(steps[indexOf(steps, "DEPLOYMENT")]?.critical).toBe(true);
  });
});

describe("approbation de production", () => {
  it("insère l'approbation entre les contrôles et la promotion", () => {
    const steps = buildDefaultSteps(
      config({
        deploymentStrategy: "staging_then_production",
        requireProductionApproval: true,
        zapEnabled: true,
      } as Partial<ProjectConfiguration>),
    );

    const approval = indexOf(steps, "APPROVAL");
    expect(approval).toBeGreaterThan(indexOf(steps, "SECURITY_GATE"));
    expect(approval).toBeLessThan(indexOf(steps, "PROMOTE"));
    expect(steps[approval]?.critical).toBe(true);
  });

  it("n'ajoute pas d'approbation quand elle n'est pas exigée", () => {
    const steps = buildDefaultSteps(
      config({
        deploymentStrategy: "staging_then_production",
        requireProductionApproval: false,
      } as Partial<ProjectConfiguration>),
    );

    expect(indexOf(steps, "APPROVAL")).toBe(-1);
  });
});
