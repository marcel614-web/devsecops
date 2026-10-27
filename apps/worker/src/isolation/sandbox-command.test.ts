// apps/worker/src/isolation/sandbox-command.test.ts
import { describe, expect, it } from "vitest";
import {
  assertContainerSecurity,
  assertSafeArtifactPath,
  buildContainerCreateArgs,
  buildContainerExecArgs,
  buildShellCommand,
  isSafeTarEntryPath,
  normalizeMountSource,
  parseContainerInspect,
  redactCommandForLog,
  sandboxContainerName,
  shellQuote,
  type ContainerInspect,
} from "./sandbox-command";
import type { SandboxLimits } from "./sandbox-config";

const limits: SandboxLimits = {
  cpus: 2,
  memoryMb: 2048,
  pids: 512,
  tmpfsMb: 1024,
  maxWorkspaceMb: 2048,
  maxArchiveMb: 512,
  minFreeDiskMb: 1024,
};

function inspect(overrides: Partial<ContainerInspect> = {}): ContainerInspect {
  return {
    running: true,
    user: "1002:1002",
    image: "node:24-alpine",
    readonlyRootfs: true,
    privileged: false,
    capDrop: ["ALL"],
    securityOpt: ["no-new-privileges:true"],
    memory: 2048 * 1024 * 1024,
    memorySwap: 2048 * 1024 * 1024,
    nanoCpus: 2_000_000_000,
    pidsLimit: 512,
    networkMode: "devsecops-sandbox-egress",
    networks: [],
    mounts: [
      {
        type: "bind",
        source: "/tmp/devsecops-sandbox/p1/workspace",
        destination: "/workspace",
        rw: true,
      },
    ],
    ...overrides,
  };
}

describe("shellQuote — couche SSH", () => {
  it("neutralise les métacaractères et les apostrophes", () => {
    const value = "a'; rm -rf / #";
    expect(shellQuote(value)).toBe("'a'\\''; rm -rf / #'");
  });

  it("garde chaque argument structuré séparé", () => {
    const line = buildShellCommand("docker", [
      "exec",
      "c",
      "npm",
      "run",
      "a; whoami",
    ]);
    expect(line).toContain("'a; whoami'");
    expect(line).not.toContain("; whoami' ");
  });
});

describe("buildContainerCreateArgs — contrat de sécurité", () => {
  const args = buildContainerCreateArgs({
    containerName: sandboxContainerName("p1"),
    image: "node:24-alpine",
    network: "devsecops-sandbox-egress",
    user: "1002:1002",
    remoteWorkspace: "/tmp/devsecops-sandbox/p1/workspace",
    limits,
    env: { HOME: "/tmp", CI: "true" },
    pipelineId: "p1",
    projectId: "proj1",
    technology: "NODEJS",
  });

  it("applique les limites et les privilèges minimaux", () => {
    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop");
    expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("--pids-limit");
    expect(args[args.indexOf("--pids-limit") + 1]).toBe("512");
    expect(args).toContain("--memory");
    expect(args[args.indexOf("--memory") + 1]).toBe("2048m");
    expect(args).toContain("--cpus");
    expect(args[args.indexOf("--cpus") + 1]).toBe("2");
    expect(args).toContain("--user");
    expect(args[args.indexOf("--user") + 1]).toBe("1002:1002");
    expect(args).not.toContain("--privileged");
  });

  it("ne monte que le workspace et jamais le socket Docker", () => {
    const mounts = args.filter((arg) => arg === "--mount");
    expect(mounts).toHaveLength(1);
    const mount = args[args.indexOf("--mount") + 1] ?? "";
    expect(mount).toContain("target=/workspace");
    expect(mount).not.toContain("docker.sock");
    expect(args.join(" ")).not.toContain("/var/run/docker.sock");
  });

  it("refuse un identifiant de pipeline ou un chemin douteux", () => {
    expect(() =>
      buildContainerCreateArgs({
        containerName: "devsecops-sandbox-../../etc",
        image: "node:24-alpine",
        network: "net",
        user: "1002:1002",
        remoteWorkspace: "/tmp/../etc",
        limits,
        env: {},
        pipelineId: "../../etc",
        projectId: "p",
        technology: "NODEJS",
      }),
    ).toThrow();
  });
});

describe("buildContainerExecArgs", () => {
  it("transmet la commande et les arguments sans les concaténer", () => {
    const args = buildContainerExecArgs({
      containerName: sandboxContainerName("p1"),
      user: "1002:1002",
      env: { CI: "true" },
      command: "npm",
      args: ["run", "test; whoami"],
    });
    expect(args).toContain("npm");
    expect(args).toContain("test; whoami");
    expect(args.filter((a) => a === "test; whoami")).toHaveLength(1);
  });
});

describe("parseContainerInspect / assertContainerSecurity", () => {
  const raw = JSON.stringify([
    {
      Config: { User: "1002:1002", Image: "node:24-alpine" },
      HostConfig: {
        ReadonlyRootfs: true,
        Privileged: false,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        Memory: 2048 * 1024 * 1024,
        MemorySwap: 2048 * 1024 * 1024,
        NanoCpus: 2_000_000_000,
        PidsLimit: 512,
        NetworkMode: "devsecops-sandbox-egress",
      },
      State: { Running: true },
      NetworkSettings: { Networks: {} },
      Mounts: [
        {
          Type: "bind",
          Source: "/tmp/devsecops-sandbox/p1/workspace",
          Destination: "/workspace",
          RW: true,
        },
      ],
    },
  ]);

  it("accepte un conteneur conforme", () => {
    const parsed = parseContainerInspect(raw);
    expect(() =>
      assertContainerSecurity(parsed, {
        user: "1002:1002",
        remoteWorkspace: "/tmp/devsecops-sandbox/p1/workspace",
        limits,
      }),
    ).not.toThrow();
  });

  it("refuse un conteneur privilégié, sans cap-drop ou avec un montage supplémentaire", () => {
    expect(() =>
      assertContainerSecurity(inspect({ privileged: true }), {
        user: "1002:1002",
        remoteWorkspace: "/tmp/devsecops-sandbox/p1/workspace",
        limits,
      }),
    ).toThrow(/privilégié/i);

    expect(() =>
      assertContainerSecurity(inspect({ capDrop: [] }), {
        user: "1002:1002",
        remoteWorkspace: "/tmp/devsecops-sandbox/p1/workspace",
        limits,
      }),
    ).toThrow(/capabilities/i);

    expect(() =>
      assertContainerSecurity(
        inspect({
          mounts: [
            ...inspect().mounts,
            {
              type: "bind",
              source: "/var/run/docker.sock",
              destination: "/var/run/docker.sock",
              rw: true,
            },
          ],
        }),
        {
          user: "1002:1002",
          remoteWorkspace: "/tmp/devsecops-sandbox/p1/workspace",
          limits,
        },
      ),
    ).toThrow(/montage/i);
  });

  it("refuse le réseau host", () => {
    expect(() =>
      assertContainerSecurity(inspect({ networkMode: "host" }), {
        user: "1002:1002",
        remoteWorkspace: "/tmp/devsecops-sandbox/p1/workspace",
        limits,
      }),
    ).toThrow(/réseau interdit/i);
  });
});

describe("validation des artefacts et chemins", () => {
  it("n'autorise que la liste fermée d'artefacts", () => {
    expect(assertSafeArtifactPath("package-lock.json")).toBe("package-lock.json");
    expect(assertSafeArtifactPath(".devsecops/pip-freeze.txt")).toBe(
      ".devsecops/pip-freeze.txt",
    );
    expect(() => assertSafeArtifactPath("../.env")).toThrow();
    expect(() => assertSafeArtifactPath("/etc/passwd")).toThrow();
  });

  it("refuse les entrées tar absolues ou remontantes", () => {
    expect(isSafeTarEntryPath("package-lock.json")).toBe(true);
    expect(isSafeTarEntryPath("./package-lock.json")).toBe(true);
    expect(isSafeTarEntryPath("../evil")).toBe(false);
    expect(isSafeTarEntryPath("/etc/passwd")).toBe(false);
    expect(isSafeTarEntryPath("C:/Windows/win.ini")).toBe(false);
  });

  it("normalise un chemin de montage Windows", () => {
    expect(normalizeMountSource("C:\\Users\\dev\\ws")).toBe("C:/Users/dev/ws");
    expect(normalizeMountSource("/tmp/ws")).toBe("/tmp/ws");
    expect(() => normalizeMountSource("/tmp/../etc")).toThrow();
  });

  it("masque les identifiants d'URL dans les logs", () => {
    expect(
      redactCommandForLog("npm --registry https://user:token@example.test/x"),
    ).not.toContain("token");
  });
});
