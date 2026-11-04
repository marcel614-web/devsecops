// apps/api/src/modules/projects/projects.security-policy.test.ts
import {
  PermissionScopeType,
  ProjectRole,
  Role,
  SpecialPermission,
} from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../utils/prisma";
import { createProject, createUser, resetDatabase } from "../../test/helpers";
import { ForbiddenError } from "../../utils/errors";
import {
  createGateException,
  decideGateException,
  listGateExceptions,
  updateProjectConfig,
} from "./projects.service";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

async function setup() {
  const admin = await createUser({
    email: "admin@test.local",
    role: Role.ADMIN,
  });
  const developer = await createUser({
    email: "dev@test.local",
    role: Role.DEVELOPER,
  });
  const project = await createProject(developer.id);
  return { admin, developer, project };
}

describe("politique de sécurité — protection backend", () => {
  it("refuse à un DEVELOPER la modification du mode et des seuils", async () => {
    const { developer, project } = await setup();
    const before = await prisma.projectConfiguration.findUniqueOrThrow({
      where: { projectId: project.id },
    });

    await expect(
      updateProjectConfig(
        { id: developer.id, role: Role.DEVELOPER },
        project.id,
        { gateMode: "ENFORCEMENT", securityGateCritical: 5 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const after = await prisma.projectConfiguration.findUniqueOrThrow({
      where: { projectId: project.id },
    });
    expect(after.gateMode).toBe(before.gateMode);
    expect(after.securityGateCritical).toBe(before.securityGateCritical);
    expect(after.policyVersion).toBe(before.policyVersion);
  });

  it("refuse à un DEVELOPER de changer la stratégie de livraison", async () => {
    const { developer, project } = await setup();
    const before = await prisma.projectConfiguration.findUniqueOrThrow({
      where: { projectId: project.id },
    });

    await expect(
      updateProjectConfig(
        { id: developer.id, role: Role.DEVELOPER },
        project.id,
        { deploymentStrategy: "staging_then_production" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const after = await prisma.projectConfiguration.findUniqueOrThrow({
      where: { projectId: project.id },
    });
    expect(after.deploymentStrategy).toBe(before.deploymentStrategy);
  });

  it("refuse à un DEVELOPER de désactiver un contrôle obligatoire", async () => {
    const { developer, project } = await setup();

    await expect(
      updateProjectConfig(
        { id: developer.id, role: Role.DEVELOPER },
        project.id,
        { scaEnabled: false },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const config = await prisma.projectConfiguration.findUniqueOrThrow({
      where: { projectId: project.id },
    });
    expect(config.scaEnabled).toBe(true);
    expect(config.mandatoryControls).toContain("SCA");
  });

  it("limite MANAGE_SECURITY_POLICY aux champs de politique", async () => {
    const { project } = await setup();
    const member = await createUser({
      email: "policy-member@test.local",
      role: Role.DEVELOPER,
    });
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId: member.id,
        role: ProjectRole.DEVELOPER,
      },
    });
    await prisma.permissionGrant.create({
      data: {
        userId: member.id,
        permission: SpecialPermission.MANAGE_SECURITY_POLICY,
        scopeType: PermissionScopeType.PROJECT,
        scopeId: project.id,
        grantedById: member.id,
      },
    });

    await updateProjectConfig(
      { id: member.id, role: Role.DEVELOPER },
      project.id,
      { gateMode: "ENFORCEMENT" },
    );
    const updated = await prisma.projectConfiguration.findUniqueOrThrow({
      where: { projectId: project.id },
    });
    expect(updated.gateMode).toBe("ENFORCEMENT");

    const beforePort = updated.stagingPort;
    await expect(
      updateProjectConfig(
        { id: member.id, role: Role.DEVELOPER },
        project.id,
        { stagingPort: beforePort + 1 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const after = await prisma.projectConfiguration.findUniqueOrThrow({
      where: { projectId: project.id },
    });
    expect(after.stagingPort).toBe(beforePort);
  });

  it("autorise un ADMIN et incrémente la version de politique", async () => {
    const { admin, project } = await setup();
    const before = await prisma.projectConfiguration.findUniqueOrThrow({
      where: { projectId: project.id },
    });

    await updateProjectConfig({ id: admin.id, role: Role.ADMIN }, project.id, {
      gateMode: "ENFORCEMENT",
      securityGateHigh: 0,
      mandatoryControls: ["SECRET", "SCA", "SAST"],
    });

    const after = await prisma.projectConfiguration.findUniqueOrThrow({
      where: { projectId: project.id },
    });
    expect(after.gateMode).toBe("ENFORCEMENT");
    expect(after.securityGateHigh).toBe(0);
    expect(after.mandatoryControls).toEqual(["SECRET", "SCA", "SAST"]);
    expect(after.policyVersion).toBe(before.policyVersion + 1);
    expect(after.policyUpdatedById).toBe(admin.id);
  });
});

describe("exceptions — workflow et historique", () => {
  it("crée une exception PENDING puis l'APPROUVE avec historique", async () => {
    const { admin, developer, project } = await setup();

    const created = await createGateException(
      { id: developer.id, role: Role.DEVELOPER },
      project.id,
      {
        category: "SCA",
        severity: "HIGH",
        fingerprint: "CVE-2026-1234",
        matchType: "CVE",
        reason: "CVE sans correctif disponible, risque accepté en revue",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    );
    expect(created.status).toBe("PENDING");

    const approved = await decideGateException(
      { id: admin.id, role: Role.ADMIN },
      project.id,
      created.id,
      "APPROVE",
      "Validé pour une release",
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedById).toBe(admin.id);
    // L'historique est renvoyé du plus récent au plus ancien.
    expect(approved.events.map((event) => event.action)).toEqual([
      "APPROVED",
      "REQUESTED",
    ]);

    const list = await listGateExceptions(
      { id: developer.id, role: Role.DEVELOPER },
      project.id,
    );
    expect(list.find((item) => item.id === created.id)?.events).toHaveLength(2);
  });

  it("refuse l'approbation par un DEVELOPER", async () => {
    const { developer, project } = await setup();
    const created = await createGateException(
      { id: developer.id, role: Role.DEVELOPER },
      project.id,
      {
        category: "SECRET",
        fingerprint: "fp-secret-1",
        matchType: "FINGERPRINT",
        reason: "Faux positif confirmé, à documenter en revue",
      },
    );

    await expect(
      decideGateException(
        { id: developer.id, role: Role.DEVELOPER },
        project.id,
        created.id,
        "APPROVE",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("marque une exception expirée sans l'appliquer", async () => {
    const { admin, developer, project } = await setup();
    const created = await createGateException(
      { id: developer.id, role: Role.DEVELOPER },
      project.id,
      {
        category: "SCA",
        fingerprint: "CVE-2026-9999",
        matchType: "CVE",
        reason: "Exception à durée courte pour vérifier l'expiration",
        expiresAt: new Date(Date.now() + 60_000),
      },
    );

    await prisma.securityGateException.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const list = await listGateExceptions(
      { id: admin.id, role: Role.ADMIN },
      project.id,
    );
    const stored = list.find((item) => item.id === created.id);
    expect(stored?.status).toBe("EXPIRED");
    expect(stored?.events.some((event) => event.action === "EXPIRED")).toBe(
      true,
    );
  });

  it("révoque logiquement au lieu de supprimer l'historique", async () => {
    const { developer, project } = await setup();
    const created = await createGateException(
      { id: developer.id, role: Role.DEVELOPER },
      project.id,
      {
        category: "SECRET",
        fingerprint: "fp-secret-2",
        matchType: "FINGERPRINT",
        reason: "Faux positif temporaire à révoquer après analyse",
      },
    );

    const revoked = await decideGateException(
      { id: developer.id, role: Role.DEVELOPER },
      project.id,
      created.id,
      "REVOKE",
    );
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.events.map((event) => event.action)).toContain("REVOKED");

    const stillThere = await prisma.securityGateException.findUnique({
      where: { id: created.id },
    });
    expect(stillThere).not.toBeNull();
  });
});
