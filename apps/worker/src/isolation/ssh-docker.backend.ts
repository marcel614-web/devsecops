// apps/worker/src/isolation/ssh-docker.backend.ts
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { SshRunner } from "../runners/ssh.runner";
import {
  buildContainerCreateArgs,
  buildContainerExecArgs,
  buildImageInspectArgs,
  buildInspectArgs,
  buildNetworkConnectArgs,
  buildNetworkCreateArgs,
  buildNetworkDisconnectArgs,
  buildNetworkInspectArgs,
  buildRemoveArgs,
  buildShellCommand,
  buildStartArgs,
  parseContainerInspect,
  assertContainerSecurity,
  assertNetworkState,
  remoteSandboxBase,
  sandboxContainerName,
  assertValidPipelineId,
  assertValidRemotePath,
  assertSafeArtifactPath,
  shellQuote,
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
import {
  assertSafeWorkspaceDir,
  createWorkspaceArchive,
  extractArtifactsArchive,
  removeArchive,
} from "./workspace-archive";
import {
  BoundedText,
  MAX_SANDBOX_OUTPUT_BYTES,
} from "./sandbox-output";

const CLEANUP_MARGIN_MS = 30_000;
const AVAILABILITY_TTL_MS = 60_000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout: () => void,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout();
      } catch {
        // ignore
      }
      reject(new SandboxTimeoutError(message));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isDockerDaemonError(stderr: string): boolean {
  return /cannot connect to the docker daemon|is the docker daemon running|permission denied while trying to connect|dial unix .*docker\.sock/i.test(
    stderr,
  );
}

function parseDockerCreatedAt(raw: string): number {
  const trimmed = raw.trim();
  // Format Docker : "2026-10-27 08:00:00 +0000 UTC"
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \+0000 UTC$/.exec(
    trimmed,
  );
  if (match) return Date.parse(`${match[1]}T${match[2]}Z`);
  return Date.parse(trimmed);
}

/**
 * Backend Docker distant : le worker n'a pas besoin d'un moteur Docker local.
 *
 * Le workspace est archivé, envoyé par SFTP, puis monté dans un conteneur
 * sur le moteur distant. Aucun répertoire de l'hôte du worker n'est monté,
 * et le socket Docker du moteur n'est jamais exposé au conteneur.
 */
export class SshDockerSandboxBackend implements SandboxBackend {
  public readonly kind = "ssh-docker" as const;

  private readonly availabilityCache = new Map<
    SandboxTechnology,
    { at: number; value: SandboxAvailability }
  >();
  private cachedKey: string | null = null;

  constructor(private readonly config: SandboxConfig) {
    if (!config.ssh) {
      throw new SandboxUnavailableError(
        "Backend ssh-docker sélectionné mais SANDBOX_SSH_HOST / " +
          "SANDBOX_SSH_USER / SANDBOX_SSH_KEY_PATH ne sont pas configurés",
      );
    }
  }

  private get sshConfig() {
    if (!this.config.ssh) throw new SandboxUnavailableError("SSH non configuré");
    return this.config.ssh;
  }

  private async privateKey(): Promise<string> {
    if (this.cachedKey !== null) return this.cachedKey;

    let keyPath = this.sshConfig.privateKeyPath;
    if (keyPath.startsWith("~")) {
      keyPath = path.join(os.homedir(), keyPath.slice(1));
    }
    try {
      const key = await fs.readFile(keyPath, "utf8");
      if (!key.includes("PRIVATE KEY")) {
        throw new Error("le fichier ne contient pas de clé PEM");
      }
      this.cachedKey = key;
      return key;
    } catch (err) {
      throw new SandboxUnavailableError(
        `Clé SSH de la sandbox illisible (${keyPath}) : ${errorMessage(err)}`,
      );
    }
  }

  private async connect(): Promise<SshRunner> {
    const ssh = new SshRunner();
    const key = await this.privateKey();
    try {
      await ssh.connect({
        host: this.sshConfig.host,
        port: this.sshConfig.port,
        username: this.sshConfig.username,
        privateKey: key,
        passphrase: this.sshConfig.passphrase,
        hostKeyFingerprint: this.sshConfig.hostKeyFingerprint,
        readyTimeoutMs: this.sshConfig.readyTimeoutMs,
      });
      return ssh;
    } catch (err) {
      throw new SandboxUnavailableError(
        `Moteur de sandbox injoignable (${this.sshConfig.username}@` +
          `${this.sshConfig.host}:${this.sshConfig.port}) : ${errorMessage(err)}`,
      );
    }
  }

  private async withSsh<T>(fn: (ssh: SshRunner) => Promise<T>): Promise<T> {
    const ssh = await this.connect();
    try {
      return await fn(ssh);
    } finally {
      await ssh.disconnect().catch(() => undefined);
    }
  }

  private async runDocker(
    ssh: SshRunner,
    args: string[],
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const command = buildShellCommand("docker", args);
    const result = await ssh.exec(command, timeoutMs);
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
  }

  private async requireDocker(
    ssh: SshRunner,
    args: string[],
    timeoutMs: number,
    label: string,
  ): Promise<string> {
    const result = await this.runDocker(ssh, args, timeoutMs);
    if (result.code !== 0) {
      const stderr = result.stderr.trim() || result.stdout.trim();
      if (isDockerDaemonError(stderr)) {
        throw new SandboxUnavailableError(
          `Moteur Docker indisponible pendant ${label} : ${stderr.slice(0, 500)}`,
        );
      }
      throw new SandboxError(`${label} a échoué (code ${result.code}) : ${stderr.slice(0, 1000)}`);
    }
    return result.stdout;
  }

  private async ensureNetwork(ssh: SshRunner): Promise<void> {
    const network = this.config.egressNetwork;
    const inspect = await this.runDocker(
      ssh,
      buildNetworkInspectArgs(network),
      60_000,
    );
    if (inspect.code === 0) return;

    const create = await this.runDocker(
      ssh,
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

  private async checkDisk(ssh: SshRunner): Promise<number | undefined> {
    try {
      const result = await ssh.exec("df -Pm /tmp", 30_000);
      const lines = result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last) return undefined;
      const fields = last.split(/\s+/);
      const available = Number.parseInt(fields[3] ?? "", 10);
      return Number.isFinite(available) ? available : undefined;
    } catch {
      return undefined;
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

    return this.withSsh(async (ssh) => {
      const version = (
        await this.requireDocker(
          ssh,
          ["version", "--format", "{{.Server.Version}}"],
          30_000,
          "docker version",
        )
      ).trim();
      if (!version) {
        throw new SandboxUnavailableError(
          "Le moteur Docker distant n'a pas retourné de version",
        );
      }

      const osType = (
        await this.requireDocker(
          ssh,
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

      const imageResult = await this.runDocker(
        ssh,
        buildImageInspectArgs(image),
        60_000,
      );
      if (imageResult.code !== 0) {
        const detail = imageResult.stderr.trim().slice(0, 500);
        if (/no such image|unable to find image/i.test(detail)) {
          throw new SandboxImageMissingError(
            `Image de sandbox absente sur le moteur : ${image}. ` +
              `Pré-téléchargez-la avec « docker pull ${image} » sur la VM ` +
              `(le worker ne télécharge pas d'image implicitement).`,
          );
        }
        throw new SandboxUnavailableError(
          `Impossible de vérifier l'image ${image} : ${detail}`,
        );
      }

      await this.ensureNetwork(ssh);

      const freeDiskMb = await this.checkDisk(ssh);
      if (
        freeDiskMb !== undefined &&
        freeDiskMb < this.config.limits.minFreeDiskMb
      ) {
        throw new SandboxUnavailableError(
          `Espace disque insuffisant sur le moteur de sandbox : ` +
            `${freeDiskMb} Mo disponibles, minimum ${this.config.limits.minFreeDiskMb} Mo`,
        );
      }

      const value: SandboxAvailability = {
        engine: `ssh://${this.sshConfig.username}@${this.sshConfig.host}:${this.sshConfig.port}`,
        version,
        image,
        freeDiskMb,
      };
      this.availabilityCache.set(technology, { at: Date.now(), value });
      return value;
    });
  }

  private async removeContainerAndWorkspace(
    ssh: SshRunner,
    containerName: string,
    remoteBase: string,
    strict = false,
  ): Promise<void> {
    const problems: string[] = [];
    try {
      const result = await this.runDocker(ssh, buildRemoveArgs(containerName), 120_000);
      if (
        result.code !== 0 &&
        !/no such container|no such object|not found/i.test(result.stderr)
      ) {
        problems.push(
          `suppression du conteneur (code ${result.code}) : ${result.stderr
            .trim()
            .slice(0, 300)}`,
        );
      }
    } catch (err) {
      problems.push(`suppression du conteneur : ${errorMessage(err)}`);
    }

    try {
      const result = await ssh.exec(`rm -rf ${shellQuote(remoteBase)}`, 120_000);
      if (result.code !== 0) {
        problems.push(
          `suppression du workspace distant (code ${result.code}) : ${result.stderr
            .trim()
            .slice(0, 300)}`,
        );
      }
    } catch (err) {
      problems.push(`suppression du workspace distant : ${errorMessage(err)}`);
    }

    if (strict && problems.length > 0) {
      throw new SandboxError(`Nettoyage de sandbox incomplet : ${problems.join(" ; ")}`);
    }
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
    const remoteBase = remoteSandboxBase(
      this.config.remoteRoot,
      spec.pipelineId,
    );
    const remoteWorkspace = assertValidRemotePath(`${remoteBase}/workspace`);
    const remoteArchive = assertValidRemotePath(`${remoteBase}/source.tar.gz`);
    const localArchive = path.join(
      os.tmpdir(),
      "devsecops-sandbox-archives",
      `${spec.pipelineId}-${randomUUID()}.tar.gz`,
    );

    let ssh: SshRunner | null = null;
    try {
      await createWorkspaceArchive(
        workspaceDir,
        localArchive,
        this.config.limits.maxArchiveMb,
        this.config.limits.maxWorkspaceMb,
      );

      ssh = await this.connect();

      const uid = (await ssh.exec("id -u", 10_000)).stdout.trim();
      const gid = (await ssh.exec("id -g", 10_000)).stdout.trim();
      if (!/^\d+$/.test(uid) || !/^\d+$/.test(gid)) {
        throw new SandboxUnavailableError(
          "Impossible de déterminer l'utilisateur non privilégié du moteur",
        );
      }
      const user = `${uid}:${gid}`;

      await this.requireDocker(
        ssh,
        ["rm", "-f", containerName],
        60_000,
        "nettoyage du conteneur précédent",
      ).catch(() => undefined);

      const prepared = await ssh.exec(
        `rm -rf ${shellQuote(remoteBase)} && mkdir -p ${shellQuote(
          `${remoteBase}/workspace`,
        )}`,
        120_000,
      );
      if (prepared.code !== 0) {
        throw new SandboxError(
          `Préparation du workspace distant échouée : ${prepared.stderr
            .trim()
            .slice(0, 500)}`,
        );
      }

      await withDeadline(
        ssh.uploadFile(localArchive, remoteArchive),
        this.config.uploadTimeoutMs,
        `Envoi de l'archive source vers le moteur de sandbox dépassé ` +
          `(${this.config.uploadTimeoutMs} ms)`,
        () => {
          void ssh?.disconnect();
        },
      );

      const extract = await ssh.exec(
        `tar -xzf ${shellQuote(remoteArchive)} -C ${shellQuote(
          remoteWorkspace,
        )} --no-same-owner && rm -f ${shellQuote(remoteArchive)}`,
        this.config.uploadTimeoutMs,
      );
      if (extract.code !== 0) {
        throw new SandboxError(
          `Extraction de l'archive source échouée : ${extract.stderr
            .trim()
            .slice(0, 1000)}`,
        );
      }

      const env = buildSandboxExecEnv({}, {});
      const createArgs = buildContainerCreateArgs({
        containerName,
        image: this.config.images[spec.technology],
        network: this.config.egressNetwork,
        user,
        remoteWorkspace,
        limits,
        env,
        pipelineId: spec.pipelineId,
        projectId: spec.projectId,
        technology: spec.technology,
      });

      let created = await this.runDocker(ssh, createArgs, 120_000);
      if (
        created.code !== 0 &&
        /already in use|is already in use/i.test(created.stderr)
      ) {
        await this.runDocker(ssh, buildRemoveArgs(containerName), 60_000);
        created = await this.runDocker(ssh, createArgs, 120_000);
      }
      if (created.code !== 0) {
        const detail = created.stderr.trim().slice(0, 1000);
        if (/no such image|unable to find image/i.test(detail)) {
          throw new SandboxImageMissingError(
            `Image de sandbox absente : ${this.config.images[spec.technology]}`,
          );
        }
        if (isDockerDaemonError(detail)) {
          throw new SandboxUnavailableError(
            `Moteur Docker indisponible : ${detail}`,
          );
        }
        throw new SandboxError(
          `Création du conteneur de sandbox échouée : ${detail}`,
        );
      }

      await this.requireDocker(
        ssh,
        buildStartArgs(containerName),
        120_000,
        "démarrage du conteneur de sandbox",
      );

      // Première vérification : le conteneur est encore sur le réseau dédié.
      const initialRaw = await this.requireDocker(
        ssh,
        buildInspectArgs(containerName),
        60_000,
        "inspection initiale du conteneur de sandbox",
      );
      const initial = parseContainerInspect(initialRaw);
      assertContainerSecurity(initial, {
        user,
        remoteWorkspace,
        limits,
        forbiddenNetworkModes: ["host"],
        allowedNetworkMode: this.config.egressNetwork,
      });

      // Le conteneur est créé avec le réseau d'egress (Docker exige un
      // réseau à la création) puis immédiatement déconnecté : l'accès
      // réseau n'est rétabli que pour les commandes d'installation.
      // Un échec de déconnexion ne doit jamais être ignoré : cela laisserait
      // un accès réseau permanent au code du dépôt.
      const disconnected = await this.runDocker(
        ssh,
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
        ssh,
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
        remoteWorkspace,
        workspaceDir,
        user,
        image: this.config.images[spec.technology],
        technology: spec.technology,
        limits,
      };
    } catch (err) {
      if (ssh) {
        await this.removeContainerAndWorkspace(ssh, containerName, remoteBase);
      }
      throw err;
    } finally {
      if (ssh) await ssh.disconnect().catch(() => undefined);
      await removeArchive(localArchive);
    }
  }

  private async setNetwork(
    ssh: SshRunner,
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
    const result = await this.runDocker(ssh, args, 60_000);
    if (result.code !== 0) {
      const detail = result.stderr.trim();
      if (
        !/already exists|already connected/i.test(detail) &&
        !/is not connected|no such container|not found/i.test(detail)
      ) {
        if (isDockerDaemonError(detail)) {
          throw new SandboxUnavailableError(
            `Moteur Docker indisponible : ${detail.slice(0, 500)}`,
          );
        }
        throw new SandboxError(
          `Changement de réseau de la sandbox échoué : ${detail.slice(0, 500)}`,
        );
      }
    }

    // Vérifie l'état effectif : un `connect` peut réussir partiellement ou
    // une déconnexion peut laisser un autre réseau attaché.
    const raw = await this.requireDocker(
      ssh,
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

  async exec(
    handle: SandboxHandle,
    request: SandboxExecRequest,
  ): Promise<SandboxExecResult> {
    const ssh = await this.connect();
    const stdout = new BoundedText(MAX_SANDBOX_OUTPUT_BYTES);
    const stderr = new BoundedText(MAX_SANDBOX_OUTPUT_BYTES);
    const started = Date.now();

    try {
      await this.setNetwork(ssh, handle, request.network);

      const args = buildContainerExecArgs({
        containerName: handle.containerName,
        user: handle.user,
        env: request.env,
        command: request.command,
        args: request.args,
      });
      const command = buildShellCommand("docker", args);

      let code: number;
      try {
        code = await ssh.execStream(
          command,
          (chunk, stream) => {
            if (stream === "stdout") stdout.append(chunk);
            else stderr.append(chunk);
            request.onData?.(chunk, stream);
          },
          request.timeoutMs + CLEANUP_MARGIN_MS,
          request.signal,
        );
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          const reason =
            request.signal?.reason === "timeout" ? "timeout" : "cancelled";
          throw new SandboxAbortError(
            reason === "timeout"
              ? `Sandbox : délai de ${request.timeoutMs} ms dépassé (${request.label})`
              : `Sandbox : exécution annulée (${request.label})`,
            reason,
          );
        }
        if (err instanceof Error && /Timeout SSH stream/i.test(err.message)) {
          throw new SandboxAbortError(err.message, "timeout");
        }
        if (err instanceof Error && /SSH|ECONN|ETIMEDOUT|EPIPE/i.test(err.message)) {
          throw new SandboxUnavailableError(
            `Connexion au moteur de sandbox perdue : ${err.message}`,
          );
        }
        throw err;
      }

      if (stderr.toString() && isDockerDaemonError(stderr.toString())) {
        throw new SandboxUnavailableError(
          `Moteur Docker indisponible : ${stderr.toString().slice(0, 500)}`,
        );
      }

      return {
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: code,
        durationMs: Date.now() - started,
      };
    } finally {
      try {
        if (request.network === "egress") {
          // Ne jamais masquer un échec de déconnexion : la session pourrait
          // rester accessible sur le réseau pour les étapes suivantes.
          await this.setNetwork(ssh, handle, "none");
        }
      } finally {
        await ssh.disconnect().catch(() => undefined);
      }
    }
  }

  async inspect(handle: SandboxHandle): Promise<ContainerInspect> {
    return this.withSsh(async (ssh) => {
      const raw = await this.requireDocker(
        ssh,
        buildInspectArgs(handle.containerName),
        60_000,
        "inspection du conteneur de sandbox",
      );
      return parseContainerInspect(raw);
    });
  }

  async isAlive(handle: SandboxHandle): Promise<boolean> {
    try {
      const inspect = await this.inspect(handle);
      return inspect.running;
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

    return this.withSsh(async (ssh) => {
      const args = buildContainerExecArgs({
        containerName: handle.containerName,
        user: handle.user,
        env: {},
        command: "test",
        args: ["-e", `/workspace/${normalized}`],
      });
      const result = await this.runDocker(ssh, args, 60_000);
      if (result.code === 0) return true;
      if (result.code === 1) return false;
      throw new SandboxError(
        `Test d'existence échoué (${relativePath}) : ${result.stderr
          .trim()
          .slice(0, 500)}`,
      );
    });
  }

  async workspaceSizeMb(handle: SandboxHandle): Promise<number> {
    return this.withSsh(async (ssh) => {
      const result = await ssh.exec(
        `du -sm ${shellQuote(handle.remoteWorkspace)}`,
        120_000,
      );
      if (result.code !== 0) {
        throw new SandboxError(
          `Impossible de mesurer le workspace de sandbox : ${result.stderr
            .trim()
            .slice(0, 500)}`,
        );
      }
      const value = Number.parseInt(result.stdout.trim().split(/\s+/)[0] ?? "", 10);
      if (!Number.isFinite(value)) {
        throw new SandboxError("Taille de workspace illisible");
      }
      return value;
    });
  }

  async syncBack(
    handle: SandboxHandle,
    artifacts: readonly string[],
  ): Promise<string[]> {
    const allowed = artifacts.map(assertSafeArtifactPath);
    if (allowed.length === 0) return [];

    const remoteBase = remoteSandboxBase(
      this.config.remoteRoot,
      handle.pipelineId,
    );
    const remoteArchive = assertValidRemotePath(`${remoteBase}/artifacts.tar.gz`);
    const localArchive = path.join(
      os.tmpdir(),
      "devsecops-sandbox-archives",
      `${handle.pipelineId}-artifacts-${randomUUID()}.tar.gz`,
    );

    return this.withSsh(async (ssh) => {
      // `docker cp` ne sait pas lire un fichier situé sur un tmpfs (`/tmp`).
      // On écrit donc l'archive dans le bind mount /workspace, sous un nom
      // aléatoire, puis on la supprime dans tous les cas.
      const containerArchive = `/workspace/.devsecops-artifacts-${randomUUID()}.tar.gz`;
      const quotedContainerArchive = shellQuote(containerArchive);
      const fileList = allowed.map((file) => shellQuote(file)).join(" ");
      const script = [
        "set -e",
        `rm -f ${quotedContainerArchive}`,
        "set --",
        `for f in ${fileList}; do`,
        '  if [ -e "$f" ]; then set -- "$@" "$f"; fi',
        "done",
        '[ "$#" -gt 0 ] || exit 3',
        // BusyBox tar (Alpine) ne supporte pas `-r` : on crée l'archive en
        // une seule passe avec les fichiers réellement présents.
        `tar -czf ${quotedContainerArchive} "$@"`,
      ].join("\n");

      const execArgs = buildContainerExecArgs({
        containerName: handle.containerName,
        user: handle.user,
        env: {},
        command: "sh",
        args: ["-c", script],
      });
      const tarResult = await this.runDocker(ssh, execArgs, 180_000);
      if (tarResult.code === 3) return [];
      if (tarResult.code !== 0) {
        await ssh
          .exec(`rm -f ${quotedContainerArchive}`, 60_000)
          .catch(() => undefined);
        throw new SandboxError(
          `Création de l'archive d'artefacts échouée : ${tarResult.stderr
            .trim()
            .slice(0, 500)}`,
        );
      }

      try {
        await this.requireDocker(
          ssh,
          [
            "cp",
            `${handle.containerName}:${containerArchive}`,
            remoteArchive,
          ],
          180_000,
          "copie des artefacts",
        );

        const sizeResult = await ssh.exec(
          `stat -c %s ${shellQuote(remoteArchive)}`,
          30_000,
        );
        const archiveBytes = Number.parseInt(sizeResult.stdout.trim(), 10);
        const maxBytes = this.config.limits.maxArchiveMb * 1024 * 1024;
        if (!Number.isFinite(archiveBytes) || archiveBytes > maxBytes) {
          throw new SandboxError(
            `Archive d'artefacts trop volumineuse ou illisible : ` +
              `${Number.isFinite(archiveBytes) ? archiveBytes : "?"} octets ` +
              `(maximum ${maxBytes})`,
          );
        }

        await withDeadline(
          ssh.downloadFile(remoteArchive, localArchive),
          this.config.uploadTimeoutMs,
          `Téléchargement des artefacts dépassé (${this.config.uploadTimeoutMs} ms)`,
          () => {
            void ssh.disconnect();
          },
        );
        return await extractArtifactsArchive(
          localArchive,
          handle.workspaceDir,
          allowed,
          maxBytes,
        );
      } finally {
        await ssh
          .exec(`rm -f ${quotedContainerArchive}`, 60_000)
          .catch(() => undefined);
        await ssh
          .exec(`rm -f ${shellQuote(remoteArchive)}`, 60_000)
          .catch(() => undefined);
        await removeArchive(localArchive);
      }
    });
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    // Ne pas avaler une erreur de nettoyage : la session la journalise et le
    // balayage des orphelins pourra reprendre le conteneur.
    await this.destroyByName(handle.pipelineId);
  }

  async destroyByName(pipelineId: string): Promise<void> {
    assertValidPipelineId(pipelineId);
    const containerName = sandboxContainerName(pipelineId);
    const remoteBase = remoteSandboxBase(this.config.remoteRoot, pipelineId);

    await this.withSsh(async (ssh) => {
      await this.removeContainerAndWorkspace(
        ssh,
        containerName,
        remoteBase,
        true,
      );
    });
  }

  async sweepOrphans(maxAgeHours: number): Promise<string[]> {
    const cutoff = Date.now() - maxAgeHours * 3600_000;

    return this.withSsh(async (ssh) => {
      const list = await ssh.exec(
        `docker ps -a --filter label=devsecops.sandbox=true ` +
          `--format '{{.Names}}|{{.CreatedAt}}'`,
        60_000,
      );
      if (list.code !== 0) {
        if (isDockerDaemonError(list.stderr)) {
          throw new SandboxUnavailableError(
            `Moteur Docker indisponible : ${list.stderr.slice(0, 500)}`,
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

        const created = createdAt ? parseDockerCreatedAt(createdAt) : NaN;
        if (!Number.isFinite(created) || created > cutoff) continue;

        const pipelineId = name.slice("devsecops-sandbox-".length);
        try {
          await this.runDocker(ssh, buildRemoveArgs(name), 120_000);
          await ssh.exec(
            `rm -rf ${shellQuote(
              remoteSandboxBase(this.config.remoteRoot, pipelineId),
            )}`,
            120_000,
          );
          removed.push(name);
        } catch {
          // on continue : les autres orphelins doivent être nettoyés
        }
      }
      return removed;
    });
  }
}
