// apps/worker/src/isolation/sandbox.ts
import type {
  SandboxLimits,
  SandboxNetwork,
  SandboxTechnology,
} from "./sandbox-config";
import {
  buildSandboxExecEnv,
  loadSandboxConfig,
  resolveSandboxBackendKind,
} from "./sandbox-config";
import type {
  SandboxBackend,
  SandboxHandle,
  SandboxSpec,
} from "./sandbox-backend";
import { SshDockerSandboxBackend } from "./ssh-docker.backend";
import { LocalDockerSandboxBackend } from "./local-docker.backend";
import {
  SandboxAbortError,
  SandboxCancelledError,
  SandboxError,
  SandboxTimeoutError,
  SandboxUnavailableError,
} from "./sandbox-errors";
import { redactCommandForLog, type ContainerInspect } from "./sandbox-command";
import { assertSafeWorkspaceDir } from "./workspace-archive";

export type SandboxLogLevel = "info" | "warn" | "error" | "debug";

export type SandboxLogger = (
  level: SandboxLogLevel,
  message: string,
) => Promise<void>;

export interface SandboxHooks {
  log?: SandboxLogger;
  isCancelled?: () => Promise<boolean>;
}

export interface SandboxRunOptions {
  command: string;
  args: string[];
  timeoutMs: number;
  network: SandboxNetwork;
  /** Variables explicitement autorisées (jamais de secrets de plateforme). */
  env?: Record<string, string>;
  label: string;
  /** Journaliser stdout/stderr au fil de l'eau (défaut : oui). */
  streamLogs?: boolean;
}

export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

class LogPump {
  private buffer = "";
  private lines = 0;
  private truncated = false;

  constructor(
    private readonly logger: SandboxLogger,
    private readonly level: "info" | "debug",
    private readonly prefix: string,
    private readonly maxLines = 400,
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      this.emit(line);
      index = this.buffer.indexOf("\n");
    }
    // Ligne anormalement longue sans retour à la ligne : on la coupe pour
    // éviter de conserver indéfiniment un buffer géant.
    if (this.buffer.length > 4000) {
      this.emit(this.buffer.slice(0, 4000));
      this.buffer = "";
    }
  }

  flush(): void {
    if (this.buffer.trim()) {
      this.emit(this.buffer);
      this.buffer = "";
    }
  }

  private emit(line: string): void {
    if (!line.trim()) return;
    if (this.lines >= this.maxLines) {
      if (!this.truncated) {
        this.truncated = true;
        void this.logger(
          "warn",
          `${this.prefix}[sortie tronquée : ${this.maxLines} lignes maximum]`,
        ).catch(() => undefined);
      }
      return;
    }
    this.lines += 1;
    const text = line.length > 2000 ? `${line.slice(0, 2000)}…` : line;
    void this.logger(this.level, `${this.prefix}${text}`).catch(
      () => undefined,
    );
  }
}

export class SandboxSession {
  private destroyed = false;

  constructor(
    private readonly backend: SandboxBackend,
    private readonly handle: SandboxHandle,
    private hooks: SandboxHooks,
  ) {}

  /**
   * Met à jour les hooks lors de la réutilisation de la session par une étape
   * différente (INSTALL_DEPS → TESTS) : les logs doivent être rattachés à
   * l'étape courante, et non à celle qui a créé la sandbox.
   */
  updateHooks(hooks: SandboxHooks): void {
    if (hooks.log) this.hooks = { ...this.hooks, log: hooks.log };
    if (hooks.isCancelled) {
      this.hooks = { ...this.hooks, isCancelled: hooks.isCancelled };
    }
  }

  get pipelineId(): string {
    return this.handle.pipelineId;
  }

  get technology(): SandboxTechnology {
    return this.handle.technology;
  }

  get containerName(): string {
    return this.handle.containerName;
  }

  get remainingWorkspaceMb(): number {
    return this.handle.limits.maxWorkspaceMb;
  }

  private log(level: SandboxLogLevel, message: string): Promise<void> {
    if (!this.hooks.log) return Promise.resolve();
    return this.hooks.log(level, message).catch(() => undefined);
  }

  private buildEnv(extra?: Record<string, string>): Record<string, string> {
    return buildSandboxExecEnv(process.env, extra);
  }

  async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
    if (this.destroyed) {
      throw new SandboxError("La sandbox a déjà été détruite");
    }

    const env = this.buildEnv(options.env);
    const controller = new AbortController();
    let pollInFlight = false;
    let pollErrorLogged = false;

    const timeoutTimer = setTimeout(
      () => controller.abort("timeout"),
      options.timeoutMs,
    );
    const cancelTimer = setInterval(() => {
      if (pollInFlight || !this.hooks.isCancelled) return;
      pollInFlight = true;
      void this.hooks
        .isCancelled()
        .then((cancelled) => {
          if (cancelled) controller.abort("cancelled");
        })
        .catch((err) => {
          if (!pollErrorLogged) {
            pollErrorLogged = true;
            void this.log(
              "warn",
              `Sandbox : vérification d'annulation impossible — ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        })
        .finally(() => {
          pollInFlight = false;
        });
    }, 2000);
    if (typeof cancelTimer.unref === "function") cancelTimer.unref();

    const commandPreview = redactCommandForLog(
      [options.command, ...options.args].join(" "),
    );
    await this.log(
      "info",
      `Sandbox [${options.label}] : ${commandPreview} ` +
        `(réseau=${options.network}, timeout=${Math.round(
          options.timeoutMs / 1000,
        )}s)`,
    );

    const stdoutPump = new LogPump(this.log.bind(this), "info", "  │ ");
    const stderrPump = new LogPump(this.log.bind(this), "debug", "  ! ");

    try {
      const result = await this.backend.exec(this.handle, {
        command: options.command,
        args: options.args,
        env,
        network: options.network,
        timeoutMs: options.timeoutMs,
        label: options.label,
        signal: controller.signal,
        onData:
          options.streamLogs === false
            ? undefined
            : (chunk, stream) => {
                if (stream === "stdout") stdoutPump.push(chunk);
                else stderrPump.push(chunk);
              },
      });

      await this.log(
        result.exitCode === 0 ? "info" : "warn",
        `Sandbox [${options.label}] : terminé en ${(
          result.durationMs / 1000
        ).toFixed(1)}s (code ${result.exitCode})`,
      );
      return result;
    } catch (err) {
      if (err instanceof SandboxAbortError) {
        await this.destroy().catch(() => undefined);
        if (err.reason === "timeout") {
          throw new SandboxTimeoutError(err.message);
        }
        throw new SandboxCancelledError(err.message);
      }
      // Une erreur d'infrastructure ou de conformité ne doit pas laisser un
      // conteneur vivant.
      await this.destroy().catch(() => undefined);
      throw err;
    } finally {
      clearTimeout(timeoutTimer);
      clearInterval(cancelTimer);
      stdoutPump.flush();
      stderrPump.flush();
    }
  }

  async syncBack(artifacts: readonly string[]): Promise<string[]> {
    const extracted = await this.backend.syncBack(this.handle, artifacts);
    if (extracted.length > 0) {
      await this.log(
        "info",
        `Sandbox : artefacts rapatriés : ${extracted.join(", ")}`,
      );
    }
    return extracted;
  }

  async workspaceSizeMb(): Promise<number> {
    return this.backend.workspaceSizeMb(this.handle);
  }

  async pathExists(relativePath: string): Promise<boolean> {
    return this.backend.pathExists(this.handle, relativePath);
  }

  async inspect(): Promise<ContainerInspect> {
    return this.backend.inspect(this.handle);
  }

  async isAlive(): Promise<boolean> {
    return this.backend.isAlive(this.handle);
  }

  async destroy(logger?: SandboxLogger): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    sessions.delete(this.pipelineId);
    const log = logger ?? this.hooks.log?.bind(this.hooks);
    try {
      await this.backend.destroy(this.handle);
      if (log) {
        await log(
          "info",
          `Sandbox détruite (conteneur ${this.containerName})`,
        ).catch(() => undefined);
      }
    } catch (err) {
      if (log) {
        await log(
          "warn",
          `Sandbox : nettoyage incomplet — ${
            err instanceof Error ? err.message : String(err)
          }`,
        ).catch(() => undefined);
      }
    }
  }
}

const sessions = new Map<string, SandboxSession>();
const pendingSessions = new Map<string, Promise<SandboxSession>>();
const knownPipelines = new Set<string>();
const backends = new Map<string, SandboxBackend>();

function getBackend(): SandboxBackend {
  let config;
  try {
    config = loadSandboxConfig();
  } catch (err) {
    throw new SandboxUnavailableError(
      `Configuration de la sandbox invalide : ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const kind = resolveSandboxBackendKind(config);
  const cacheKey = `${kind}:${config.ssh?.host ?? "local"}:${
    config.ssh?.port ?? ""
  }:${config.ssh?.privateKeyPath ?? ""}`;
  const cached = backends.get(cacheKey);
  if (cached) return cached;

  const backend =
    kind === "ssh-docker"
      ? new SshDockerSandboxBackend(config)
      : new LocalDockerSandboxBackend(config);
  backends.set(cacheKey, backend);
  return backend;
}

function mergeLimits(
  base: SandboxLimits,
  override?: Partial<SandboxLimits>,
): SandboxLimits {
  if (!override) return base;
  const merged = { ...base, ...override };
  const positive: Array<[keyof SandboxLimits, number]> = [
    ["cpus", merged.cpus],
    ["memoryMb", merged.memoryMb],
    ["pids", merged.pids],
    ["tmpfsMb", merged.tmpfsMb],
    ["maxWorkspaceMb", merged.maxWorkspaceMb],
    ["maxArchiveMb", merged.maxArchiveMb],
  ];
  for (const [key, value] of positive) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new SandboxUnavailableError(
        `Limite de sandbox invalide pour ${key}: ${value}`,
      );
    }
  }
  if (!Number.isFinite(merged.minFreeDiskMb) || merged.minFreeDiskMb < 0) {
    throw new SandboxUnavailableError(
      `Limite de sandbox invalide pour minFreeDiskMb: ${merged.minFreeDiskMb}`,
    );
  }
  return merged;
}

/**
 * Ouvre (ou réutilise) la sandbox d'un pipeline.
 *
 * La session est conservée entre INSTALL_DEPS et TESTS. Le moteur de
 * pipeline la détruit dans un `finally`, y compris en cas d'annulation, de
 * timeout ou d'exception.
 */
export async function openSandbox(
  spec: SandboxSpec,
  hooks: SandboxHooks = {},
  limitsOverride?: Partial<SandboxLimits>,
): Promise<SandboxSession> {
  const existing = sessions.get(spec.pipelineId);
  if (existing && existing.technology === spec.technology) {
    if (await existing.isAlive()) {
      existing.updateHooks(hooks);
      return existing;
    }
    await existing.destroy();
  } else if (existing) {
    await existing.destroy();
  }

  const pending = pendingSessions.get(spec.pipelineId);
  if (pending) return pending;

  const promise = (async () => {
    await assertSafeWorkspaceDir(spec.workspaceDir, spec.pipelineId);
    const backend = getBackend();
    const config = loadSandboxConfig();
    const limits = mergeLimits(config.limits, limitsOverride);

    const availability = await backend.ensureAvailable(spec.technology);
    if (hooks.log) {
      await hooks.log(
        "info",
        `Sandbox : moteur ${availability.engine} (Docker ${availability.version}), ` +
          `image ${availability.image}` +
          (availability.freeDiskMb !== undefined
            ? `, disque libre ${availability.freeDiskMb} Mo`
            : ""),
      );
      await hooks.log(
        "info",
        `Sandbox : limites CPU=${limits.cpus}, RAM=${limits.memoryMb} Mo, ` +
          `pids=${limits.pids}, /tmp=${limits.tmpfsMb} Mo, ` +
          `workspace max=${limits.maxWorkspaceMb} Mo`,
      );
    }

    const handle = await backend.create(spec, limits);
    knownPipelines.add(spec.pipelineId);
    const session = new SandboxSession(backend, handle, hooks);
    sessions.set(spec.pipelineId, session);

    if (hooks.log) {
      await hooks.log(
        "info",
        `Sandbox : conteneur ${handle.containerName} prêt ` +
          `(utilisateur ${handle.user}, réseau coupé par défaut)`,
      );
    }
    return session;
  })();

  pendingSessions.set(spec.pipelineId, promise);
  try {
    return await promise;
  } finally {
    pendingSessions.delete(spec.pipelineId);
  }
}

/** Détruit la sandbox d'un pipeline (idempotent, ne lève jamais). */
export async function destroySandbox(
  pipelineId: string,
  logger?: SandboxLogger,
): Promise<void> {
  const session = sessions.get(pipelineId);
  if (session) {
    await session.destroy(logger);
    knownPipelines.delete(pipelineId);
    return;
  }

  if (!knownPipelines.has(pipelineId)) return;

  try {
    const backend = getBackend();
    await backend.destroyByName(pipelineId);
    knownPipelines.delete(pipelineId);
    if (logger) {
      await logger(
        "info",
        `Sandbox : conteneur résiduel nettoyé pour ${pipelineId}`,
      );
    }
  } catch (err) {
    if (logger) {
      await logger(
        "warn",
        `Sandbox : nettoyage impossible pour ${pipelineId} — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/** Détruit toutes les sessions connues (arrêt du worker). */
export async function destroyAllSandboxes(): Promise<void> {
  const all = [...sessions.values()];
  await Promise.allSettled(all.map((session) => session.destroy()));
  knownPipelines.clear();
}

/**
 * Nettoie les conteneurs de sandbox orphelins (worker redémarré, crash).
 * À appeler au démarrage ; ne bloque pas le worker en cas d'échec.
 */
export async function sweepOrphanSandboxes(
  logger?: SandboxLogger,
): Promise<string[]> {
  try {
    const backend = getBackend();
    const config = loadSandboxConfig();
    const removed = await backend.sweepOrphans(config.orphanMaxAgeHours);
    if (logger && removed.length > 0) {
      await logger(
        "info",
        `Sandbox : ${removed.length} conteneur(s) orphelin(s) nettoyé(s) : ` +
          removed.join(", "),
      );
    }
    return removed;
  } catch (err) {
    if (logger) {
      await logger(
        "debug",
        `Sandbox : balayage des orphelins ignoré — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return [];
  }
}

/** Test uniquement : vide les caches en mémoire (sans toucher aux conteneurs). */
export function __resetSandboxStateForTests(): void {
  sessions.clear();
  pendingSessions.clear();
  knownPipelines.clear();
  backends.clear();
}

export type { SandboxSpec, SandboxHandle };
