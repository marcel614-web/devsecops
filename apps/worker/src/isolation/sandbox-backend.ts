// apps/worker/src/isolation/sandbox-backend.ts
import type {
  SandboxBackendKind,
  SandboxLimits,
  SandboxNetwork,
  SandboxTechnology,
} from "./sandbox-config";
import type { ContainerInspect } from "./sandbox-command";

export interface SandboxSpec {
  pipelineId: string;
  projectId: string;
  workspaceDir: string;
  technology: SandboxTechnology;
}

export interface SandboxHandle {
  backend: SandboxBackendKind;
  pipelineId: string;
  containerName: string;
  /** Chemin du workspace dans le conteneur / sur le moteur distant. */
  remoteWorkspace: string;
  /** Workspace local (hôte du worker), source de l'archive. */
  workspaceDir: string;
  user: string;
  image: string;
  technology: SandboxTechnology;
  limits: SandboxLimits;
}

export interface SandboxAvailability {
  engine: string;
  version: string;
  image: string;
  freeDiskMb?: number;
}

export interface SandboxExecRequest {
  command: string;
  args: string[];
  env: Record<string, string>;
  network: SandboxNetwork;
  /** Délai maximal de l'opération (hors marge de nettoyage). */
  timeoutMs: number;
  label: string;
  onData?: (chunk: string, stream: "stdout" | "stderr") => void;
  signal?: AbortSignal;
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Abstraction de runner : le reste du worker ne connaît ni SSH ni Docker.
 * Chaque backend doit échouer explicitement si son moteur est indisponible.
 */
export interface SandboxBackend {
  readonly kind: SandboxBackendKind;

  ensureAvailable(technology: SandboxTechnology): Promise<SandboxAvailability>;

  create(spec: SandboxSpec, limits: SandboxLimits): Promise<SandboxHandle>;

  exec(handle: SandboxHandle, request: SandboxExecRequest): Promise<SandboxExecResult>;

  inspect(handle: SandboxHandle): Promise<ContainerInspect>;

  isAlive(handle: SandboxHandle): Promise<boolean>;

  /**
   * Rapatrie uniquement les artefacts de la liste fermée
   * (`ARTIFACT_ALLOWLIST`) vers le workspace local.
   */
  syncBack(handle: SandboxHandle, artifacts: readonly string[]): Promise<string[]>;

  workspaceSizeMb(handle: SandboxHandle): Promise<number>;

  /** Teste l'existence d'un chemin relatif dans /workspace. */
  pathExists(handle: SandboxHandle, relativePath: string): Promise<boolean>;

  destroy(handle: SandboxHandle): Promise<void>;

  /** Nettoyage par identifiant, même si le handle en mémoire est perdu. */
  destroyByName(pipelineId: string): Promise<void>;

  /** Supprime les conteneurs de sandbox plus vieux que `maxAgeHours`. */
  sweepOrphans(maxAgeHours: number): Promise<string[]>;
}
