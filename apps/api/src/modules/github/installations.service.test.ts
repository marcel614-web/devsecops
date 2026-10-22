// apps/api/src/modules/github/installations.service.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../../utils/prisma";
import { resetDatabase, createUser } from "../../test/helpers";
import { ConflictError } from "../../utils/errors";

/**
 * On mocke l'appel réseau à l'API GitHub : le test porte uniquement sur la
 * logique d'attribution de l'installation.
 */
vi.mock("./github-app.service", () => ({
  fetchInstallation: vi.fn(async (installationId: string) => ({
    id: Number(installationId),
    account: { login: "acme-org", id: 4242, type: "Organization" },
    target_type: "Organization",
    suspended_at: null,
  })),
  getInstallationOctokit: vi.fn(async () => ({
    apps: {
      listReposAccessibleToInstallation: vi.fn(async () => ({
        data: { repositories: [] as unknown[] },
      })),
    },
  })),
  invalidateInstallationToken: vi.fn(),
}));

import { syncInstallation } from "./installations.service";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("syncInstallation — propriété de l'installation", () => {
  it("crée l'installation pour le premier utilisateur", async () => {
    const user = await createUser({ email: "alice@test.local" });

    const result = await syncInstallation({
      userId: user.id,
      installationId: "1001",
    });

    expect(result.accountLogin).toBe("acme-org");
    const stored = await prisma.gitHubInstallation.findUnique({
      where: { installationId: "1001" },
      select: { userId: true },
    });
    expect(stored?.userId).toBe(user.id);
  });

  it("refuse de transférer l'installation à un autre utilisateur", async () => {
    const alice = await createUser({ email: "alice@test.local" });
    const bob = await createUser({ email: "bob@test.local" });

    await syncInstallation({ userId: alice.id, installationId: "2002" });

    await expect(
      syncInstallation({ userId: bob.id, installationId: "2002" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("ne change pas le propriétaire en base après un refus", async () => {
    const alice = await createUser({ email: "alice@test.local" });
    const bob = await createUser({ email: "bob@test.local" });

    await syncInstallation({ userId: alice.id, installationId: "3003" });
    await expect(
      syncInstallation({ userId: bob.id, installationId: "3003" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const stored = await prisma.gitHubInstallation.findUnique({
      where: { installationId: "3003" },
      select: { userId: true },
    });
    expect(stored?.userId).toBe(alice.id);
  });

  it("autorise le même utilisateur à resynchroniser", async () => {
    const alice = await createUser({ email: "alice@test.local" });

    await syncInstallation({ userId: alice.id, installationId: "4004" });
    await expect(
      syncInstallation({ userId: alice.id, installationId: "4004" }),
    ).resolves.toBeDefined();
  });

  it("autorise un nouveau propriétaire si l'installation a été révoquée", async () => {
    const alice = await createUser({ email: "alice@test.local" });
    const bob = await createUser({ email: "bob@test.local" });

    await syncInstallation({ userId: alice.id, installationId: "5005" });
    await prisma.gitHubInstallation.update({
      where: { installationId: "5005" },
      data: { revokedAt: new Date() },
    });

    await expect(
      syncInstallation({ userId: bob.id, installationId: "5005" }),
    ).resolves.toBeDefined();

    const stored = await prisma.gitHubInstallation.findUnique({
      where: { installationId: "5005" },
      select: { userId: true },
    });
    expect(stored?.userId).toBe(bob.id);
  });
});
