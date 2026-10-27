// apps/worker/src/isolation/local-docker.backend.ts
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { execTool } from "@devsecops/shared";
import {
  assertContainerSecurity,
  assertNetworkState,
  assertSafeArtifactPath,
  buildContainerCreateArgs,
  buildContainerExecArgs,
  buildImageInspectArgs,
  buildInspectArgs,
  buildNetworkConnectArgs,
  buildNetworkCreateArgs,
  buildNetworkDisconnectArgs,
  buildNetworkInspectArgs,
  buildRemoveArgs,
  buildStartArgs,
  normalizeMountSource,
  parseContainerInspect,
  sandboxContainerName,
  assertValidPipelineId,
  type ContainerInspect,
} from "./sandbox-command";
import {
  buildSandboxExecEnv,
  type SandboxConfig,
  type SandboxLimits,
  type SandboxTechnology,
} from "./sandbox-config";
import type {
  SandboxAvailability,
  SandboxBackend,
  SandboxExecRequest,
  SandboxExecResult,
  SandboxHandle,
  SandboxSpec,
} from "./sandbox-backend";
import {
  SandboxAbortError,
  SandboxError,
  SandboxImageMissingError,
  SandboxTimeoutError,
  SandboxUnavailableError,
} from "./sandbox-errors";
import { assertSafeWorkspaceDir, workspaceSizeMb } from "./workspace-archive";
import {
  BoundedText,
  MAX_SANDBOX_OUTPUT_BYTES,
} from "./sandbox-output";

const AVAILABILITY_TTL_MS = 60_000;

interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isDockerDaemonError(stderr: string): boolean {
  return /cannot connect to the docker daemon|is the docker daemon running|permission denied while trying to connect|dial unix .*docker\.sock/i.test(
    stderr,
  );
}

function asDockerResult(err: unknown): DockerResult {
  const any = err as {
    code?: number | string;
    stdout?: string;
    stderr?: string;
    message?: string;
  };
  const code =
    typeof any.code === "number"
      ? any.code
      : Number.parseInt(String(any.code ?? ""), 10);
  return {
    code: Number.isFinite(code) ? code : 1,
    stdout: any.stdout ?? "",
    stderr: any.stderr ?? any.message ?? errorMessage(err),
  };
}

/**
 * Backend Docker local (worker Linux ou Docker Desktop).
 *
 * Utile en CI et pour les développeurs. Le laboratoire actuel utilise le
 * backend SSH car le worker Windows n'a pas de moteur Docker local.
 */
export class LocalDockerSandboxBackend implements SandboxBackend {
  public readonly kind = "local-docker" as const;
  private readonly availabilityCache = new Map<
    SandboxTechnology,
    { at: number; value: SandboxAvailability }
  >();

  constructor(private readonly config: SandboxConfig) {}

  private async tryDocker(args: string[], timeoutMs: number): Promise<DockerResult> {
    try {
      const result = await execTool("docker", args, {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      });
      return { code: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (err) {
      return asDockerResult(err);
    }
  }

  private async requireDocker(
    args: string[],
    timeoutMs: number,
    label: string,
  ): Promise<string> {
    const result = await this.tryDocker(args, timeoutMs);
    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();
      if (/ENOENT|not recognized|introuvable/i.test(detail)) {
        throw new SandboxUnavailableError(
          `Docker CLI introuvable sur le worker. Installez Docker ou ` +
            `configurez SANDBOX_BACKEND=ssh-docker.`,
        );
      }
      if (isDockerDaemonError(detail)) {
        throw new SandboxUnavailableError(
          `Moteur Docker local indisponible : ${detail.slice(0, 500)}`,
        );
      }
      throw new SandboxError(
        `${label} a échoué (code ${result.code}) : ${detail.slice(0, 1000)}`,
      );
    }
    return result.stdout;
  }

  private async ensureNetwork(): Promise<void> {
    const network = this.config.egressNetwork;
    const inspect = await this.tryDocker(
      buildNetworkInspectArgs(network),
      60_000,
    );
    if (inspect.code === 0) return;
    const create = await this.tryDocker(
      buildNetworkCreateArgs(network),
      60_000,
    );
    if (create.code !== 0 && !/already exists/i.test(create.stderr)) {
      throw new SandboxUnavailableError(
        `Impossible de créer le réseau de sandbox ${network} : ` +
          create.stderr.trim().slice(0, 500),
      );
    }
  }

  async ensureAvailable(
    technology: SandboxTechnology,
  ): Promise<SandboxAvailability> {
    const cached = this.availabilityCache.get(technology);
    if (cached && Date.now() - cached.at < AVAILABILITY_TTL_MS) {
      return cached.value;
    }

    const image = this.config.images[technology];
    const version = (
      await this.requireDocker(
        ["version", "--format", "{{.Server.Version}}"],
        30_000,
        "docker version",
      )
    ).trim();
    if (!version) {
      throw new SandboxUnavailableError(
        "Le moteur Docker local n'a pas retourné de version",
      );
    }

    const osType = (
      await this.requireDocker(
        ["info", "--format", "{{.OSType}}"],
        30_000,
        "docker info",
      )
    ).trim();
    if (osType !== "linux") {
      throw new SandboxUnavailableError(
        `Le moteur de sandbox doit être Linux (reçu: ${osType || "inconnu"})`,
      );
    }

    const imageResult = await this.tryDocker(
      buildImageInspectArgs(image),
      60_000,
    );
    if (imageResult.code !== 0) {
      const detail = imageResult.stderr.trim().slice(0, 500);
      if (/no such image|unable to find image/i.test(detail)) {
        throw new SandboxImageMissingError(
          `Image de sandbox absente : ${image}. Pré-téléchargez-la avec ` +
            `« docker pull ${image} ».`,
        );
      }
      throw new SandboxUnavailableError(
        `Impossible de vérifier l'image ${image} : ${detail}`,
      );
    }

    await this.ensureNetwork();

    const value: SandboxAvailability = {
      engine: "local-docker",
      version,
      image,
    };
    this.availabilityCache.set(technology, { at: Date.now(), value });
    return value;
  }

  async create(
    spec: SandboxSpec,
    limits: SandboxLimits,
  ): Promise<SandboxHandle> {
    const workspaceDir = await assertSafeWorkspaceDir(
      spec.workspaceDir,
      spec.pipelineId,
    );
    await this.ensureAvailable(spec.technology);

    const containerName = sandboxContainerName(spec.pipelineId);
    const user =
      process.platform === "win32"
        ? "1000:1000"
        : `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
    const mountSource = normalizeMountSource(workspaceDir);

    const env = buildSandboxExecEnv({}, {});
    const createArgs = buildContainerCreateArgs({
      containerName,
      image: this.config.images[spec.technology],
      network: this.config.egressNetwork,
      user,
      remoteWorkspace: mountSource,
      limits,
      env,
      pipelineId: spec.pipelineId,
      projectId: spec.projectId,
      technology: spec.technology,
    });

    try {
      await this.tryDocker(buildRemoveArgs(containerName), 60_000);
      let created = await this.tryDocker(createArgs, 120_000);
      if (
        created.code !== 0 &&
        /already in use|is already in use/i.test(created.stderr)
      ) {
        await this.tryDocker(buildRemoveArgs(containerName), 60_000);
        created = await this.tryDocker(createArgs, 120_000);
      }
      if (created.code !== 0) {
        const detail = created.stderr.trim().slice(0, 1000);
        if (/no such image|unable to find image/i.test(detail)) {
          throw new SandboxImageMissingError(
            `Image de sandbox absente : ${this.config.images[spec.technology]}`,
          );
        }
        if (isDockerDaemonError(detail) || /ENOENT|not recognized/i.test(detail)) {
          throw new SandboxUnavailableError(
            `Moteur Docker local indisponible : ${detail}`,
          );
        }
        throw new SandboxError(
          `Création du conteneur de sandbox échouée : ${detail}`,
        );
      }

      await this.requireDocker(
        buildStartArgs(containerName),
        120_000,
        "démarrage du conteneur de sandbox",
      );

      const initialRaw = await this.requireDocker(
        buildInspectArgs(containerName),
        60_000,
        "inspection initiale du conteneur de sandbox",
      );
      const initial = parseContainerInspect(initialRaw);
      assertContainerSecurity(initial, {
        user,
        remoteWorkspace: mountSource,
        limits,
        forbiddenNetworkModes: ["host"],
        allowedNetworkMode: this.config.egressNetwork,
      });

      const disconnected = await this.tryDocker(
        buildNetworkDisconnectArgs(this.config.egressNetwork, containerName),
        60_000,
      );
      if (
        disconnected.code !== 0 &&
        !/not connected|no such container|not found/i.test(disconnected.stderr)
      ) {
        throw new SandboxError(
          `Déconnexion réseau de la sandbox échouée : ${disconnected.stderr
            .trim()
            .slice(0, 500)}`,
        );
      }

      const inspectRaw = await this.requireDocker(
        buildInspectArgs(containerName),
        60_000,
        "inspection du conteneur de sandbox",
      );
      const inspect = parseContainerInspect(inspectRaw);
      assertNetworkState(inspect, "none", this.config.egressNetwork);

      return {
        backend: this.kind,
        pipelineId: spec.pipelineId,
        containerName,
        remoteWorkspace: mountSource,
        workspaceDir,
        user,
        image: this.config.images[spec.technology],
        technology: spec.technology,
        limits,
      };
    } catch (err) {
      await this.tryDocker(buildRemoveArgs(containerName), 120_000).catch(
        () => undefined,
      );
      throw err;
    }
  }

  private async setNetwork(
    handle: SandboxHandle,
    network: "none" | "egress",
  ): Promise<void> {
    const args =
      network === "egress"
        ? buildNetworkConnectArgs(this.config.egressNetwork, handle.containerName)
        : buildNetworkDisconnectArgs(
            this.config.egressNetwork,
            handle.containerName,
          );
    const result = await this.tryDocker(args, 60_000);
    if (result.code !== 0) {
      const detail = result.stderr.trim();
      if (
        !/already exists|already connected/i.test(detail) &&
        !/is not connected|no such container|not found/i.test(detail)
      ) {
        if (isDockerDaemonError(detail)) {
          throw new SandboxUnavailableError(
            `Moteur Docker local indisponible : ${detail.slice(0, 500)}`,
          );
        }
        throw new SandboxError(
          `Changement de réseau de la sandbox échoué : ${detail.slice(0, 500)}`,
        );
      }
    }

    const raw = await this.requireDocker(
      buildInspectArgs(handle.containerName),
      60_000,
      "vérification du réseau de la sandbox",
    );
    assertNetworkState(
      parseContainerInspect(raw),
      network,
      this.config.egressNetwork,
    );
  }

  private runStreaming(
    args: string[],
    request: SandboxExecRequest,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const stdout = new BoundedText(MAX_SANDBOX_OUTPUT_BYTES);
    const stderr = new BoundedText(MAX_SANDBOX_OUTPUT_BYTES);

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      let child: ReturnType<typeof spawn> | null = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
      };
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const onAbort = () => {
        try {
          child?.kill("SIGTERM");
        } catch {
          // ignore
        }
        const reason =
          request.signal?.reason === "timeout" ? "timeout" : "cancelled";
        finish(() =>
          reject(
            new SandboxAbortError(
              reason === "timeout"
                ? `Sandbox : délai de ${request.timeoutMs} ms dépassé (${request.label})`
                : `Sandbox : exécution annulée (${request.label})`,
              reason,
            ),
          ),
        );
      };

      timer = setTimeout(() => {
        try {
          child?.kill("SIGTERM");
        } catch {
          // ignore
        }
        finish(() =>
          reject(
            new SandboxTimeoutError(
              `Sandbox : délai de ${request.timeoutMs} ms dépassé (${request.label})`,
            ),
          ),
        );
      }, request.timeoutMs);

      if (request.signal?.aborted) {
        onAbort();
        return;
      }
      request.signal?.addEventListener("abort", onAbort, { once: true });

      child = spawn("docker", args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdout.append(text);
        request.onData?.(text, "stdout");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderr.append(text);
        request.onData?.(text, "stderr");
      });
      child.on("error", (err) => finish(() => reject(err)));
      child.on("close", (code) => {
        finish(() =>
          resolve({
            exitCode: typeof code === "number" ? code : 1,
            stdout: stdout.toString(),
            stderr: stderr.toString(),
          }),
        );
      });
    });
  }

  async exec(
    handle: SandboxHandle,
    request: SandboxExecRequest,
  ): Promise<SandboxExecResult> {
    const started = Date.now();
    try {
      await this.setNetwork(handle, request.network);
      const args = buildContainerExecArgs({
        containerName: handle.containerName,
        user: handle.user,
        env: request.env,
        command: request.command,
        args: request.args,
      });
      const result = await this.runStreaming(args, request);
      if (result.stderr && isDockerDaemonError(result.stderr)) {
        throw new SandboxUnavailableError(
          `Moteur Docker local indisponible : ${result.stderr.slice(0, 500)}`,
        );
      }
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new SandboxAbortError("Abandon de la sandbox", "cancelled");
      }
      throw err;
    } finally {
      if (request.network === "egress") {
        await this.setNetwork(handle, "none");
      }
    }
  }

  async inspect(handle: SandboxHandle): Promise<ContainerInspect> {
    const raw = await this.requireDocker(
      buildInspectArgs(handle.containerName),
      60_000,
      "inspection du conteneur de sandbox",
    );
    return parseContainerInspect(raw);
  }

  async isAlive(handle: SandboxHandle): Promise<boolean> {
    try {
      return (await this.inspect(handle)).running;
    } catch {
      return false;
    }
  }

  async pathExists(
    handle: SandboxHandle,
    relativePath: string,
  ): Promise<boolean> {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (
      !normalized ||
      normalized.startsWith("/") ||
      normalized.includes("..") ||
      /[\0\r\n]/.test(normalized)
    ) {
      throw new SandboxError(`Chemin relatif invalide: ${relativePath}`);
    }
    try {
      await fs.access(`${handle.workspaceDir}/${normalized}`);
      return true;
    } catch {
      return false;
    }
  }

  async workspaceSizeMb(handle: SandboxHandle): Promise<number> {
    return workspaceSizeMb(handle.workspaceDir);
  }

  async syncBack(
    handle: SandboxHandle,
    artifacts: readonly string[],
  ): Promise<string[]> {
    const present: string[] = [];
    for (const artifact of artifacts) {
      const safe = assertSafeArtifactPath(artifact);
      try {
        await fs.access(`${handle.workspaceDir}/${safe}`);
        present.push(safe);
      } catch {
        // absent : ignoré
      }
    }
    return present;
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    await this.destroyByName(handle.pipelineId);
  }

  async destroyByName(pipelineId: string): Promise<void> {
    assertValidPipelineId(pipelineId);
    const result = await this.tryDocker(
      buildRemoveArgs(sandboxContainerName(pipelineId)),
      120_000,
    );
    if (
      result.code !== 0 &&
      !/no such container|no such object|not found/i.test(result.stderr)
    ) {
      throw new SandboxError(
        `Suppression du conteneur de sandbox échouée : ${result.stderr
          .trim()
          .slice(0, 500)}`,
      );
    }
  }

  async sweepOrphans(maxAgeHours: number): Promise<string[]> {
    const cutoff = Date.now() - maxAgeHours * 3600_000;
    const list = await this.tryDocker(
      [
        "ps",
        "-a",
        "--filter",
        "label=devsecops.sandbox=true",
        "--format",
        "{{.Names}}|{{.CreatedAt}}",
      ],
      60_000,
    );
    if (list.code !== 0) {
      if (isDockerDaemonError(list.stderr)) {
        throw new SandboxUnavailableError(
          `Moteur Docker local indisponible : ${list.stderr.slice(0, 500)}`,
        );
      }
      throw new SandboxError(
        `Liste des sandboxes échouée : ${list.stderr.slice(0, 500)}`,
      );
    }

    const removed: string[] = [];
    for (const line of list.stdout.split("\n")) {
      const [name, createdAt] = line.trim().split("|");
      if (!name || !name.startsWith("devsecops-sandbox-")) continue;
      if (!/^devsecops-sandbox-[A-Za-z0-9_-]+$/.test(name)) continue;
      const created = createdAt ? Date.parse(createdAt) : NaN;
      if (!Number.isFinite(created) || created > cutoff) continue;
      const result = await this.tryDocker(buildRemoveArgs(name), 120_000);
      if (result.code === 0) removed.push(name);
    }
    return removed;
  }
}
