// apps/api/src/modules/pipelines/policy-snapshot.test.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../utils/prisma";
import { createProject, createUser, resetDatabase } from "../../test/helpers";
import { buildSecurityPolicy, hashSecurityPolicy } from "@devsecops/shared";
import { createPipelineSecurityPolicy } from "./policy-snapshot";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("instantané de politique par pipeline", () => {
  it("fige les seuils et le mode au moment de la création", async () => {
    const owner = await createUser({ email: "snapshot@test.local" });
    const project = await createProject(owner.id);
    const config = await prisma.projectConfiguration.findUniqueOrThrow({
      where: { projectId: project.id },
    });

    const pipeline = await prisma.pipeline.create({
      data: {
        projectId: project.id,
        commitSha: "abc123",
        branch: "main",
        author: owner.name,
      },
    });

    await prisma.$transaction((tx) =>
      createPipelineSecurityPolicy(tx, {
        pipelineId: pipeline.id,
        projectId: project.id,
        config,
      }),
    );

    const snapshot = await prisma.pipelineSecurityPolicy.findUniqueOrThrow({
      where: { pipelineId: pipeline.id },
    });
    const expected = buildSecurityPolicy(config);
    expect(snapshot.version).toBe(config.policyVersion);
    expect(snapshot.policyHash).toBe(hashSecurityPolicy(expected));
    expect(snapshot.policyJson).toMatchObject({
      mode: "WARNING",
      thresholds: {
        critical: config.securityGateCritical,
        high: config.securityGateHigh,
      },
    });

    // La configuration courante change : l'instantané du pipeline ne doit pas
    // être recalculé silencieusement.
    await prisma.projectConfiguration.update({
      where: { projectId: project.id },
      data: {
        gateMode: "ENFORCEMENT",
        securityGateCritical: 99,
        policyVersion: { increment: 1 },
      },
    });

    const unchanged = await prisma.pipelineSecurityPolicy.findUniqueOrThrow({
      where: { pipelineId: pipeline.id },
    });
    expect(unchanged.policyHash).toBe(snapshot.policyHash);
    expect(unchanged.policyJson).toMatchObject({
      mode: "WARNING",
      thresholds: { critical: config.securityGateCritical },
    });
  });
});
