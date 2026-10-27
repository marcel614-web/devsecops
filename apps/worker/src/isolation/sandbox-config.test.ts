// apps/worker/src/isolation/sandbox-config.test.ts
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSandboxExecEnv,
  isValidImageRef,
  loadSandboxConfig,
  resolveSandboxBackendKind,
} from "./sandbox-config";

const KEYS = [
  "SANDBOX_BACKEND",
  "SANDBOX_SSH_HOST",
  "SANDBOX_SSH_PORT",
  "SANDBOX_SSH_USER",
  "SANDBOX_SSH_KEY_PATH",
  "SANDBOX_CPUS",
  "SANDBOX_MEMORY_MB",
  "SANDBOX_PIDS",
  "SANDBOX_TMPFS_MB",
  "SANDBOX_MAX_WORKSPACE_MB",
  "SANDBOX_MAX_ARCHIVE_MB",
  "SANDBOX_MIN_FREE_DISK_MB",
  "SANDBOX_TEST_NETWORK",
  "SANDBOX_NODE_IMAGE",
  "SANDBOX_PHP_IMAGE",
  "SANDBOX_PYTHON_IMAGE",
  "SANDBOX_EGRESS_NETWORK",
  "PIP_INDEX_URL",
  "PIP_TRUSTED_HOST",
  "PIP_RETRIES",
  "PIP_DEFAULT_TIMEOUT",
];

const saved: Record<string, string | undefined> = {};
for (const key of KEYS) saved[key] = process.env[key];

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("loadSandboxConfig", () => {
  it("fournit des valeurs par défaut sûres", () => {
    for (const key of KEYS) delete process.env[key];
    const config = loadSandboxConfig();
    expect(config.backend).toBe("auto");
    expect(config.images.NODEJS).toBe("node:24-alpine");
    expect(config.images.PYTHON).toBe("python:3.12-slim");
    expect(config.limits.memoryMb).toBe(2048);
    expect(config.limits.cpus).toBe(1);
    expect(config.limits.pids).toBe(512);
    expect(config.testNetwork).toBe("none");
    expect(config.ssh).toBeNull();
  });

  it("accepte une configuration SSH complète", () => {
    process.env.SANDBOX_SSH_HOST = "127.0.0.1";
    process.env.SANDBOX_SSH_PORT = "2222";
    process.env.SANDBOX_SSH_USER = "deploy";
    process.env.SANDBOX_SSH_KEY_PATH = "C:/keys/deploy";
    const config = loadSandboxConfig();
    expect(config.ssh?.port).toBe(2222);
    expect(resolveSandboxBackendKind(config)).toBe("ssh-docker");
  });

  it("refuse une configuration SSH incomplète", () => {
    process.env.SANDBOX_SSH_HOST = "127.0.0.1";
    delete process.env.SANDBOX_SSH_USER;
    delete process.env.SANDBOX_SSH_KEY_PATH;
    expect(() => loadSandboxConfig()).toThrow(/incomplète/i);
  });

  it("refuse les valeurs hors bornes", () => {
    process.env.SANDBOX_CPUS = "99";
    expect(() => loadSandboxConfig()).toThrow(/SANDBOX_CPUS/);
    process.env.SANDBOX_CPUS = "2";
    process.env.SANDBOX_BACKEND = "execution-directe";
    expect(() => loadSandboxConfig()).toThrow(/SANDBOX_BACKEND/);
    process.env.SANDBOX_BACKEND = "auto";
    process.env.SANDBOX_TEST_NETWORK = "internet";
    expect(() => loadSandboxConfig()).toThrow(/SANDBOX_TEST_NETWORK/);
  });

  it("refuse une image ressemblant à une option Docker", () => {
    expect(isValidImageRef("node:24-alpine")).toBe(true);
    expect(isValidImageRef("--privileged")).toBe(false);
    expect(isValidImageRef("node:24 alpine")).toBe(false);
  });

  it("ne transmet pas d'identifiants de registre pip", () => {
    process.env.PIP_INDEX_URL = "https://user:secret@mirror/simple";
    process.env.PIP_TRUSTED_HOST = "mirror";
    const env = buildSandboxExecEnv();
    expect(env.PIP_INDEX_URL).toBeUndefined();
    expect(env.PIP_TRUSTED_HOST).toBe("mirror");
    expect(env.PIP_CACHE_DIR).toBe("/tmp/pip-cache");
    expect(env.PATH).toBeUndefined();
  });
});
