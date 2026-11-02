// apps/worker/src/security/policy.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSecurityPolicy,
  hashSecurityPolicy,
} from "@devsecops/shared";

const { findUnique, create, findSecurityPolicy } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  findSecurityPolicy: vi.fn(),
}));

vi.mock("../utils/prisma", () => ({
  prisma: {
    pipeline: { findUnique },
    pipelineSecurityPolicy: {
      create,
      findUnique: findSecurityPolicy,
    },
  },
}));

import { loadPipelineSecurityPolicy } from "./policy";

function config(overrides: Record<string, unknown> = {}) {
  return {
    securityGateCritical: 0,
    securityGateHigh: 2,
    securityGateMedium: 10,
    securityGateLow: -1,
    gateMode: "WARNING",
    gateEnforcementAt: null,
    gateSecretsEnabled: true,
    gateSastEnabled: true,
    gateScaEnabled: true,
    gateImageEnabled: true,
    gateIacEnabled: true,
    gateDastEnabled: true,
    gitleaksEnabled: true,
    semgrepEnabled: true,
    scaEnabled: true,
    trivyEnabled: true,
    iacEnabled: true,
    zapEnabled: true,
    mandatoryControls: ["SECRET", "SCA"],
    requireExceptionApproval: true,
    policyVersion: 7,
    ...overrides,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  create.mockReset();
  findSecurityPolicy.mockReset();
});

describe("loadPipelineSecurityPolicy", () => {
  it("réutilise l'instantané du pipeline sans relire la config courante", async () => {
    const snapshot = buildSecurityPolicy(
      config({ gateMode: "ENFORCEMENT", policyVersion: 3 }),
    );
    findUnique.mockResolvedValue({
      securityPolicy: {
        id: "policy-1",
        policyHash: hashSecurityPolicy(snapshot),
        policyJson: snapshot,
      },
      project: { config: config({ gateMode: "WARNING", policyVersion: 9 }) },
    });

    const loaded = await loadPipelineSecurityPolicy("pipeline-1", "project-1");

    expect(loaded.createdFromCurrentConfig).toBe(false);
    expect(loaded.snapshotId).toBe("policy-1");
    expect(loaded.policy.version).toBe(3);
    expect(loaded.policy.mode).toBe("ENFORCEMENT");
    expect(create).not.toHaveBeenCalled();
  });

  it("crée un instantané pour un pipeline historique et le signale", async () => {
    const current = config({ policyVersion: 4 });
    const policy = buildSecurityPolicy(current);
    findUnique.mockResolvedValue({
      securityPolicy: null,
      project: { config: current },
    });
    create.mockResolvedValue({ id: "policy-new" });
    const log = vi.fn().mockResolvedValue(undefined);

    const loaded = await loadPipelineSecurityPolicy(
      "pipeline-2",
      "project-1",
      log,
    );

    expect(loaded.createdFromCurrentConfig).toBe(true);
    expect(loaded.snapshotId).toBe("policy-new");
    expect(loaded.policy.version).toBe(4);
    expect(hashSecurityPolicy(loaded.policy)).toBe(hashSecurityPolicy(policy));
    expect(log).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("pipeline historique"),
    );
  });

  it("refuse de recalculer une décision déjà persistée sans instantané", async () => {
    findUnique.mockResolvedValue({
      securityPolicy: null,
      gateResult: { id: "gate-old" },
      project: { config: config({ policyVersion: 9 }) },
    });

    await expect(
      loadPipelineSecurityPolicy("pipeline-3", "project-1"),
    ).rejects.toThrow(/aucun instantané de politique/);
    expect(create).not.toHaveBeenCalled();
  });
});
