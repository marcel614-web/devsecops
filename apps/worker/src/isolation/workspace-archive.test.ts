// apps/worker/src/isolation/workspace-archive.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import {
  SANDBOX_WORKSPACES_ROOT,
} from "./sandbox-config";
import {
  assertSafeWorkspaceDir,
  createWorkspaceArchive,
  extractArtifactsArchive,
} from "./workspace-archive";

const pipelineId = `test-archive-${Date.now()}`;
const workspace = path.join(SANDBOX_WORKSPACES_ROOT, pipelineId);
const archive = path.join(
  os.tmpdir(),
  "devsecops-sandbox-archives",
  `${pipelineId}.tar.gz`,
);
const extracted = path.join(
  os.tmpdir(),
  "devsecops-sandbox-archives",
  `${pipelineId}-extracted`,
);

beforeAll(async () => {
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "node_modules"), { recursive: true });
  await fs.mkdir(path.join(workspace, ".git"), { recursive: true });
  await fs.mkdir(path.join(workspace, "dist"), { recursive: true });
  await fs.writeFile(path.join(workspace, "package.json"), "{}");
  await fs.writeFile(path.join(workspace, "package-lock.json"), "{}");
  await fs.writeFile(path.join(workspace, "src", "index.js"), "console.log(1)");
  await fs.writeFile(path.join(workspace, ".env"), "SECRET=1");
  await fs.writeFile(path.join(workspace, "id_rsa"), "PRIVATE");
  await fs.writeFile(path.join(workspace, "evil.txt"), "evil");
  await fs.writeFile(path.join(workspace, "node_modules", "x.js"), "x");
  await fs.writeFile(path.join(workspace, ".git", "config"), "x");
  await fs.writeFile(path.join(workspace, "dist", "app.js"), "x");
});

afterAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(archive, { force: true }).catch(() => undefined);
  await fs.rm(extracted, { recursive: true, force: true }).catch(() => undefined);
});

describe("assertSafeWorkspaceDir", () => {
  it("accepte le workspace attendu du pipeline", async () => {
    await expect(assertSafeWorkspaceDir(workspace, pipelineId)).resolves.toBe(
      await fs.realpath(workspace),
    );
  });

  it("refuse un workspace hors racine ou un identifiant douteux", async () => {
    await expect(
      assertSafeWorkspaceDir(path.join(os.tmpdir(), "ailleurs"), pipelineId),
    ).rejects.toThrow();
    await expect(
      assertSafeWorkspaceDir(workspace, "../evasion"),
    ).rejects.toThrow(/invalide/i);
  });
});

describe("archive source de la sandbox", () => {
  it("exclut secrets, historique et dépendances", async () => {
    const result = await createWorkspaceArchive(workspace, archive, 128);
    expect(result.bytes).toBeGreaterThan(0);

    await fs.mkdir(extracted, { recursive: true });
    await tar.extract({ file: archive, cwd: extracted, strict: true });

    await expect(
      fs.access(path.join(extracted, "package.json")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(extracted, "src", "index.js")),
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(extracted, ".env"))).rejects.toThrow();
    await expect(fs.access(path.join(extracted, "id_rsa"))).rejects.toThrow();
    await expect(
      fs.access(path.join(extracted, "node_modules", "x.js")),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(extracted, ".git", "config")),
    ).rejects.toThrow();
    await expect(fs.access(path.join(extracted, "dist", "app.js"))).rejects.toThrow();
  });

  it("n'extrait sur l'hôte que les artefacts autorisés", async () => {
    const before = await fs.readFile(
      path.join(workspace, "package-lock.json"),
      "utf8",
    );
    const extractedArtifacts = await extractArtifactsArchive(archive, workspace, [
      "package-lock.json",
    ]);
    expect(extractedArtifacts).toEqual(["package-lock.json"]);
    expect(await fs.readFile(path.join(workspace, "package-lock.json"), "utf8")).toBe(
      before,
    );
  });

  it("refuse un artefact hors liste", async () => {
    await expect(
      extractArtifactsArchive(archive, workspace, ["evil.txt"]),
    ).rejects.toThrow(/non autorisé/i);
  });
});
