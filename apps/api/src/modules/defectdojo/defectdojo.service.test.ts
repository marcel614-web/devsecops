// apps/api/src/modules/defectdojo/defectdojo.service.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../utils/prisma";
import { resetDatabase } from "../../test/helpers";
import * as service from "./defectdojo.service";

describe("DefectDojo service", () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.systemConfig.create({
      data: { key: "default" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("configure et teste la connexion", async () => {
    const updated = await service.updateDefectDojoConfig(
      { url: "https://dojo.example", apiToken: "token-123" },
      "admin-id",
    );
    expect(updated.configured).toBe(true);
    expect(updated.hasApiToken).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    const result = await service.testDefectDojoConnection({
      url: "https://dojo.example",
      apiToken: "token-123",
    });
    expect(result.ok).toBe(true);
  });

  it("rejette une connexion invalide", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );

    const result = await service.testDefectDojoConnection({
      url: "https://dojo.example",
      apiToken: "bad-token",
    });
    expect(result.ok).toBe(false);
  });
});