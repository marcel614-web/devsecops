// apps/worker/src/isolation/sandbox.integration.test.ts
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  __resetSandboxStateForTests,
  destroySandbox,
  openSandbox,
  type SandboxHooks,
} from "./sandbox";
import {
  SANDBOX_WORKSPACES_ROOT,
  loadSandboxConfig,
} from "./sandbox-config";
import {
  SandboxCancelledError,
  SandboxTimeoutError,
  SandboxUnavailableError,
} from "./sandbox-errors";
import { SshDockerSandboxBackend } from "./ssh-docker.backend";
import type { SandboxSpec } from "./sandbox-backend";

const enabled = process.env.SANDBOX_INTEGRATION === "1";
const createdIds = new Set<string>();
let counter = 0;

function newId(): string {
  counter += 1;
  const id = `it-${Date.now()}-${counter}`;
  createdIds.add(id);
  return id;
}

async function makeWorkspace(pipelineId: string): Promise<string> {
  const dir = path.join(SANDBOX_WORKSPACES_ROOT, pipelineId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "sandbox-probe", version: "1.0.0" }),
  );
  return dir;
}

function spec(pipelineId: string, workspaceDir: string): SandboxSpec {
  return {
    pipelineId,
    projectId: `proj-${pipelineId}`,
    workspaceDir,
    technology: "NODEJS",
  };
}

function hooks(): SandboxHooks & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    log: async (level, message) => {
      lines.push(`${level}: ${message}`);
    },
  };
}

afterAll(async () => {
  for (const id of createdIds) {
    await destroySandbox(id).catch(() => undefined);
    await fs
      .rm(path.join(SANDBOX_WORKSPACES_ROOT, id), {
        recursive: true,
        force: true,
      })
      .catch(() => undefined);
  }
  __resetSandboxStateForTests();
}, 120_000);

describe.skipIf(!enabled)("sandbox réelle (SSH-Docker)", () => {
  it(
    "isole l'environnement, tourne en non-root et ne monte pas le socket Docker",
    async () => {
      const id = newId();
      const workspace = await makeWorkspace(id);
      const h = hooks();
      const session = await openSandbox(spec(id, workspace), h);
      try {
        const inspect = await session.inspect();
        expect(inspect.user).toMatch(/^\d+:\d+$/);
        expect(inspect.user).not.toBe("0:0");
        expect(inspect.readonlyRootfs).toBe(true);
        expect(inspect.privileged).toBe(false);
        expect(inspect.capDrop.map((c) => c.toUpperCase())).toContain("ALL");
        expect(inspect.mounts).toHaveLength(1);
        expect(inspect.mounts[0]?.destination).toBe("/workspace");
        expect(inspect.mounts.some((m) => m.source.includes("docker.sock"))).toBe(
          false,
        );

        const script = `
          const fs = require("node:fs");
          console.log(JSON.stringify({
            db: process.env.DATABASE_URL ?? null,
            master: process.env.MASTER_ENCRYPTION_KEY ?? null,
            github: process.env.GITHUB_TOKEN ?? null,
            uid: typeof process.getuid === "function" ? process.getuid() : null,
            cwd: process.cwd(),
            dockerSock: fs.existsSync("/var/run/docker.sock"),
          }));
        `;
        const result = await session.run({
          command: "node",
          args: ["-e", script],
          timeoutMs: 60_000,
          network: "none",
          label: "probe env",
        });
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(
          result.stdout.trim().split("\n").pop() ?? "{}",
        ) as {
          db: string | null;
          master: string | null;
          github: string | null;
          uid: number | null;
          cwd: string;
          dockerSock: boolean;
        };
        expect(output.db).toBeNull();
        expect(output.master).toBeNull();
        expect(output.github).toBeNull();
        expect(output.uid).not.toBe(0);
        expect(output.cwd).toBe("/workspace");
        expect(output.dockerSock).toBe(false);
      } finally {
        await session.destroy();
      }
    },
    120_000,
  );

  it(
    "coupe le réseau par défaut et ne l'ouvre que pendant l'egress",
    async () => {
      const id = newId();
      const workspace = await makeWorkspace(id);
      const session = await openSandbox(spec(id, workspace), hooks());
      try {
        const offline = await session.run({
          command: "getent",
          args: ["hosts", "registry.npmjs.org"],
          timeoutMs: 30_000,
          network: "none",
          label: "dns offline",
        });
        expect(offline.exitCode).not.toBe(0);

        const online = await session.run({
          command: "getent",
          args: ["hosts", "registry.npmjs.org"],
          timeoutMs: 30_000,
          network: "egress",
          label: "dns egress",
        });
        expect(online.exitCode).toBe(0);
        expect(online.stdout).toContain("registry.npmjs.org");

        const offlineAgain = await session.run({
          command: "getent",
          args: ["hosts", "registry.npmjs.org"],
          timeoutMs: 30_000,
          network: "none",
          label: "dns offline again",
        });
        expect(offlineAgain.exitCode).not.toBe(0);
      } finally {
        await session.destroy();
      }
    },
    120_000,
  );

  it(
    "arrête et nettoie une commande qui dépasse le délai",
    async () => {
      const id = newId();
      const workspace = await makeWorkspace(id);
      const session = await openSandbox(spec(id, workspace), hooks());
      await expect(
        session.run({
          command: "sh",
          args: ["-c", "sleep 30"],
          timeoutMs: 2_000,
          network: "none",
          label: "timeout",
        }),
      ).rejects.toBeInstanceOf(SandboxTimeoutError);
      await expect(session.isAlive()).resolves.toBe(false);
      await session.destroy();
    },
    120_000,
  );

  it(
    "arrête et nettoie une commande annulée",
    async () => {
      const id = newId();
      const workspace = await makeWorkspace(id);
      const deadline = Date.now() + 1_000;
      const session = await openSandbox(spec(id, workspace), {
        log: async () => undefined,
        isCancelled: async () => Date.now() >= deadline,
      });
      await expect(
        session.run({
          command: "sh",
          args: ["-c", "sleep 30"],
          timeoutMs: 60_000,
          network: "none",
          label: "cancel",
        }),
      ).rejects.toBeInstanceOf(SandboxCancelledError);
      await expect(session.isAlive()).resolves.toBe(false);
      await session.destroy();
    },
    120_000,
  );

  it(
    "applique les limites CPU/RAM et tue un dépassement mémoire",
    async () => {
      const id = newId();
      const workspace = await makeWorkspace(id);
      const session = await openSandbox(spec(id, workspace), hooks(), {
        memoryMb: 128,
        cpus: 0.5,
        pids: 128,
        tmpfsMb: 64,
        maxWorkspaceMb: 256,
        maxArchiveMb: 64,
        minFreeDiskMb: 0,
      });
      try {
        const inspect = await session.inspect();
        expect(inspect.memory).toBe(128 * 1024 * 1024);
        expect(inspect.nanoCpus).toBe(500_000_000);
        expect(inspect.pidsLimit).toBe(128);

        const start = Date.now();
        const result = await session.run({
          command: "node",
          args: [
            "-e",
            "const a=[]; for (;;) a.push(Buffer.alloc(1024 * 1024));",
          ],
          timeoutMs: 30_000,
          network: "none",
          label: "memory hog",
        });
        expect(result.exitCode).not.toBe(0);
        expect(Date.now() - start).toBeLessThan(30_000);
      } finally {
        await session.destroy();
      }
    },
    120_000,
  );

  it(
    "rapatrie uniquement les artefacts autorisés depuis la sandbox",
    async () => {
      const id = newId();
      const workspace = await makeWorkspace(id);
      const session = await openSandbox(spec(id, workspace), hooks());
      try {
        const created = await session.run({
          command: "sh",
          args: [
            "-c",
            "printf '{\"lockfileVersion\":3}\\n' > package-lock.json && " +
              "printf 'PRIVATE\\n' > id_rsa",
          ],
          timeoutMs: 30_000,
          network: "none",
          label: "prepare artifacts",
        });
        expect(created.exitCode).toBe(0);

        const artifacts = await session.syncBack(["package-lock.json"]);
        expect(artifacts).toEqual(["package-lock.json"]);
        const hostContent = await fs.readFile(
          path.join(workspace, "package-lock.json"),
          "utf8",
        );
        expect(hostContent).toContain("lockfileVersion");
        await expect(
          session.syncBack(["id_rsa"]),
        ).rejects.toThrow(/non autorisé/i);
        await expect(fs.access(path.join(workspace, "id_rsa"))).rejects.toThrow();
      } finally {
        await session.destroy();
      }
    },
    120_000,
  );

  it("échoue explicitement si le moteur est injoignable", async () => {
    const config = loadSandboxConfig();
    if (!config.ssh) throw new Error("configuration SSH absente");
    const backend = new SshDockerSandboxBackend({
      ...config,
      ssh: { ...config.ssh, port: 1, readyTimeoutMs: 2_000 },
    });
    await expect(backend.ensureAvailable("NODEJS")).rejects.toBeInstanceOf(
      SandboxUnavailableError,
    );
  }, 30_000);

  it("refuse un workspace hors de la racine autorisée", async () => {
    const id = newId();
    await expect(
      openSandbox(spec(id, path.join(path.dirname(SANDBOX_WORKSPACES_ROOT), "ailleurs")), hooks()),
    ).rejects.toThrow(/Workspace/i);
  }, 30_000);
});
