// apps/worker/src/isolation/sandbox-command.ts
import path from "node:path";
import type {
  SandboxLimits,
  SandboxTechnology,
} from "./sandbox-config";

/**
 * Construction pure des arguments Docker et validation des chemins.
 *
 * Ce module ne lance aucun processus : il est testable sans moteur Docker et
 * sert de barrière de sécurité (montages, privilèges, réseau, échappement
 * shell pour la couche SSH).
 */

export interface ContainerCreateParams {
  containerName: string;
  image: string;
  network: string;
  user: string;
  remoteWorkspace: string;
  limits: SandboxLimits;
  env: Record<string, string>;
  pipelineId: string;
  projectId: string;
  technology: SandboxTechnology;
}

export interface ContainerInspect {
  running: boolean;
  user: string;
  image: string;
  readonlyRootfs: boolean;
  privileged: boolean;
  capDrop: string[];
  securityOpt: string[];
  memory: number;
  memorySwap: number;
  nanoCpus: number;
  pidsLimit: number | null;
  networkMode: string;
  networks: string[];
  mounts: Array<{
    type: string;
    source: string;
    destination: string;
    rw: boolean;
  }>;
}

export class SandboxPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxPathError";
  }
}

export class SandboxSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxSecurityError";
  }
}

/**
 * Un identifiant de pipeline est utilisé dans un nom de conteneur et un
 * chemin distant. On n'accepte qu'un alphabet strict : pas de `/`, `..`,
 * espace, métacaractère shell ou caractère de contrôle.
 */
export function assertValidPipelineId(pipelineId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(pipelineId)) {
    throw new SandboxPathError(
      `Identifiant de pipeline invalide pour la sandbox: ${JSON.stringify(
        pipelineId,
      )}`,
    );
  }
  return pipelineId;
}

export function sandboxContainerName(pipelineId: string): string {
  return `devsecops-sandbox-${assertValidPipelineId(pipelineId)}`;
}

export function remoteSandboxBase(remoteRoot: string, pipelineId: string): string {
  if (!/^\/[A-Za-z0-9/_-]*$/.test(remoteRoot) || remoteRoot.includes("..")) {
    throw new SandboxPathError(`Racine distante invalide: ${remoteRoot}`);
  }
  return `${remoteRoot.replace(/\/+$/, "")}/${assertValidPipelineId(
    pipelineId,
  )}`;
}

export function assertValidRemotePath(remotePath: string): string {
  if (
    !remotePath.startsWith("/") ||
    remotePath.includes("..") ||
    remotePath.includes("\\") ||
    /[\0\r\n]/.test(remotePath)
  ) {
    throw new SandboxPathError(`Chemin distant invalide: ${remotePath}`);
  }
  return remotePath;
}

/**
 * Valide la source d'un montage. En backend local Windows, la source peut
 * être un chemin `C:\...` (converti en `C:/...` pour Docker Desktop) ; en
 * backend distant, elle doit rester un chemin POSIX absolu.
 */
export function normalizeMountSource(source: string): string {
  if (/^[A-Za-z]:[\\/]/.test(source)) {
    if (source.includes("..") || /[\0\r\n]/.test(source)) {
      throw new SandboxPathError(`Chemin de montage invalide: ${source}`);
    }
    return source.replace(/\\/g, "/");
  }
  return assertValidRemotePath(source);
}

/**
 * Échappe une valeur pour un shell POSIX.
 *
 * La couche SSH est le seul endroit où l'on construit une ligne de commande
 * (l'API `exec` de SSH n'accepte qu'une chaîne). Chaque argument est encadré
 * de guillemets simples ; une apostrophe est fermée, échappée puis rouverte.
 * Aucune valeur n'est concaténée hors guillemets.
 */
export function shellQuote(value: string): string {
  if (value.includes("\0")) {
    throw new SandboxPathError("Argument contenant un octet NUL refusé");
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Construit une ligne de commande shell à partir d'arguments structurés. */
export function buildShellCommand(command: string, args: string[]): string {
  if (!command || command.includes("\0")) {
    throw new SandboxPathError("Commande vide ou invalide");
  }
  return [command, ...args].map(shellQuote).join(" ");
}

function envArgs(env: Record<string, string>): string[] {
  const result: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new SandboxPathError(`Nom de variable invalide: ${name}`);
    }
    if (value.includes("\0")) {
      throw new SandboxPathError(`Valeur NUL refusée pour ${name}`);
    }
    result.push("--env", `${name}=${value}`);
  }
  return result;
}

export function buildContainerCreateArgs(
  params: ContainerCreateParams,
): string[] {
  const {
    containerName,
    image,
    network,
    user,
    remoteWorkspace,
    limits,
    env,
    pipelineId,
    projectId,
    technology,
  } = params;

  assertValidPipelineId(pipelineId);
  const mountSource = normalizeMountSource(remoteWorkspace);
  if (!/^\d+:\d+$/.test(user)) {
    throw new SandboxSecurityError(`Utilisateur conteneur invalide: ${user}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(network)) {
    throw new SandboxSecurityError(`Réseau invalide: ${network}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image)) {
    throw new SandboxSecurityError(`Image invalide: ${image}`);
  }
  if (!containerName.startsWith("devsecops-sandbox-")) {
    throw new SandboxSecurityError(
      `Nom de conteneur hors espace de noms: ${containerName}`,
    );
  }

  return [
    "create",
    "--name",
    containerName,
    "--label",
    "devsecops.sandbox=true",
    "--label",
    `devsecops.pipeline=${assertValidPipelineId(pipelineId)}`,
    "--label",
    `devsecops.project=${assertValidPipelineId(projectId)}`,
    "--label",
    `devsecops.technology=${technology}`,
    "--user",
    user,
    "--workdir",
    "/workspace",
    "--mount",
    `type=bind,source=${mountSource},target=/workspace`,
    "--read-only",
    // `exec` est nécessaire aux gestionnaires de paquets (scripts temporaires,
    // construction de wheels). Le code non fiable peut déjà exécuter du code
    // depuis /workspace : ce n'est pas une élévation de privilège.
    "--tmpfs",
    `/tmp:rw,exec,nosuid,nodev,size=${limits.tmpfsMb}m`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    String(limits.pids),
    "--memory",
    `${limits.memoryMb}m`,
    "--memory-swap",
    `${limits.memoryMb}m`,
    "--cpus",
    String(limits.cpus),
    "--ulimit",
    "nofile=4096:4096",
    "--init",
    "--network",
    network,
    ...envArgs(env),
    image,
    "sleep",
    "infinity",
  ];
}

export function buildContainerExecArgs(params: {
  containerName: string;
  user: string;
  env: Record<string, string>;
  command: string;
  args: string[];
}): string[] {
  const { containerName, user, env, command, args } = params;
  if (!containerName.startsWith("devsecops-sandbox-")) {
    throw new SandboxSecurityError(
      `Conteneur hors espace de noms: ${containerName}`,
    );
  }
  if (!/^\d+:\d+$/.test(user)) {
    throw new SandboxSecurityError(`Utilisateur conteneur invalide: ${user}`);
  }
  if (!command || command.includes("\0")) {
    throw new SandboxPathError("Commande vide ou invalide");
  }
  for (const arg of args) {
    if (arg.includes("\0")) {
      throw new SandboxPathError("Argument contenant un octet NUL refusé");
    }
  }

  return [
    "exec",
    "--user",
    user,
    "--workdir",
    "/workspace",
    ...envArgs(env),
    containerName,
    command,
    ...args,
  ];
}

export function buildInspectArgs(containerName: string): string[] {
  return ["inspect", containerName];
}

export function buildRemoveArgs(containerName: string): string[] {
  return ["rm", "-f", containerName];
}

export function buildStartArgs(containerName: string): string[] {
  return ["start", containerName];
}

export function buildNetworkConnectArgs(
  network: string,
  containerName: string,
): string[] {
  return ["network", "connect", network, containerName];
}

export function buildNetworkDisconnectArgs(
  network: string,
  containerName: string,
): string[] {
  return ["network", "disconnect", network, containerName];
}

export function buildImageInspectArgs(image: string): string[] {
  return ["image", "inspect", "--format", "{{.Id}}", image];
}

export function buildNetworkInspectArgs(network: string): string[] {
  return ["network", "inspect", network];
}

export function buildNetworkCreateArgs(network: string): string[] {
  return [
    "network",
    "create",
    "--driver",
    "bridge",
    "--label",
    "devsecops.sandbox=true",
    network,
  ];
}

/**
 * Valide et normalise la sortie de `docker inspect`.
 *
 * Les champs peuvent varier selon la version du moteur ; on reste strict sur
 * les propriétés de sécurité, avec des valeurs par défaut sûres.
 */
export function parseContainerInspect(raw: string): ContainerInspect {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SandboxSecurityError(
      `Sortie docker inspect illisible: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!item || typeof item !== "object") {
    throw new SandboxSecurityError("docker inspect n'a retourné aucun objet");
  }

  const obj = item as Record<string, unknown>;
  const config = (obj.Config ?? {}) as Record<string, unknown>;
  const host = (obj.HostConfig ?? {}) as Record<string, unknown>;
  const state = (obj.State ?? {}) as Record<string, unknown>;
  const networkSettings = (obj.NetworkSettings ?? {}) as Record<string, unknown>;

  const mountsRaw = Array.isArray(obj.Mounts) ? obj.Mounts : [];
  const mounts = mountsRaw.map((entry) => {
    const mount = entry as Record<string, unknown>;
    return {
      type: String(mount.Type ?? ""),
      source: String(mount.Source ?? ""),
      destination: String(mount.Destination ?? ""),
      rw: mount.RW !== false,
    };
  });

  const networksObj =
    networkSettings.Networks && typeof networkSettings.Networks === "object"
      ? (networkSettings.Networks as Record<string, unknown>)
      : {};

  const capDrop = Array.isArray(host.CapDrop)
    ? host.CapDrop.map(String)
    : [];
  const securityOpt = Array.isArray(host.SecurityOpt)
    ? host.SecurityOpt.map(String)
    : [];

  return {
    running: state.Running === true,
    user: String(config.User ?? ""),
    image: String(config.Image ?? ""),
    readonlyRootfs: host.ReadonlyRootfs === true,
    privileged: host.Privileged === true,
    capDrop,
    securityOpt,
    memory: Number(host.Memory ?? 0),
    memorySwap: Number(host.MemorySwap ?? 0),
    nanoCpus: Number(host.NanoCpus ?? 0),
    pidsLimit:
      host.PidsLimit === null || host.PidsLimit === undefined
        ? null
        : Number(host.PidsLimit),
    networkMode: String(host.NetworkMode ?? ""),
    networks: Object.keys(networksObj),
    mounts,
  };
}

export interface ExpectedContainerSecurity {
  user: string;
  remoteWorkspace: string;
  limits: SandboxLimits;
  /** Réseau autorisé uniquement pendant les installations. */
  forbiddenNetworkModes?: string[];
  /**
   * À la création, le conteneur doit être rattaché au réseau d'egress dédié
   * (il en est déconnecté juste après). Sans cette vérification, un conteneur
   * resté sur le bridge Docker par défaut aurait un accès réseau permanent.
   */
  allowedNetworkMode?: string;
}

/**
 * Vérifie après création que le conteneur correspond bien au contrat de
 * sécurité. En cas d'écart, l'appelant doit détruire le conteneur et échouer.
 */
export function assertContainerSecurity(
  inspect: ContainerInspect,
  expected: ExpectedContainerSecurity,
): void {
  const problems: string[] = [];

  if (!inspect.running) problems.push("le conteneur n'est pas démarré");
  if (inspect.user !== expected.user) {
    problems.push(
      `utilisateur ${inspect.user || "(root)"} au lieu de ${expected.user}`,
    );
  }
  if (!inspect.readonlyRootfs) problems.push("racine non read-only");
  if (inspect.privileged) problems.push("conteneur privilégié");
  if (!inspect.capDrop.some((cap) => cap.toUpperCase() === "ALL")) {
    problems.push("capabilities non supprimées (cap-drop ALL absent)");
  }
  if (
    !inspect.securityOpt.some((opt) =>
      opt.toLowerCase().startsWith("no-new-privileges"),
    )
  ) {
    problems.push("no-new-privileges absent");
  }
  if (inspect.memory !== expected.limits.memoryMb * 1024 * 1024) {
    problems.push(`limite mémoire inattendue: ${inspect.memory}`);
  }
  if (inspect.memorySwap !== expected.limits.memoryMb * 1024 * 1024) {
    problems.push(`limite swap inattendue: ${inspect.memorySwap}`);
  }
  const expectedNano = Math.round(expected.limits.cpus * 1_000_000_000);
  if (inspect.nanoCpus !== expectedNano) {
    problems.push(`limite CPU inattendue: ${inspect.nanoCpus}`);
  }
  if (inspect.pidsLimit !== expected.limits.pids) {
    problems.push(`limite pids inattendue: ${inspect.pidsLimit}`);
  }
  if (
    inspect.networkMode === "host" ||
    inspect.networkMode === "container:host" ||
    (expected.forbiddenNetworkModes ?? []).includes(inspect.networkMode)
  ) {
    problems.push(`mode réseau interdit: ${inspect.networkMode}`);
  }
  if (
    expected.allowedNetworkMode !== undefined &&
    inspect.networkMode !== expected.allowedNetworkMode
  ) {
    problems.push(
      `réseau ${inspect.networkMode || "(inconnu)"} au lieu de ` +
        `${expected.allowedNetworkMode}`,
    );
  }

  if (inspect.mounts.length !== 1) {
    problems.push(`${inspect.mounts.length} montage(s) au lieu d'un seul`);
  }
  const mount = inspect.mounts[0];
  if (!mount) {
    problems.push("aucun montage /workspace");
  } else {
    if (mount.destination !== "/workspace") {
      problems.push(`montage sur ${mount.destination} au lieu de /workspace`);
    }
    const actualSource = mount.source.replace(/\\/g, "/");
    const expectedSource = expected.remoteWorkspace.replace(/\\/g, "/");
    const sameSource =
      process.platform === "win32"
        ? actualSource.toLowerCase() === expectedSource.toLowerCase()
        : actualSource === expectedSource;
    if (!sameSource) {
      problems.push(`source de montage inattendue: ${mount.source}`);
    }
    if (!mount.rw) problems.push("workspace monté en lecture seule");
    if (mount.type !== "bind") {
      problems.push(`type de montage inattendu: ${mount.type}`);
    }
  }
  for (const m of inspect.mounts) {
    if (
      m.source.includes("docker.sock") ||
      m.destination.includes("docker.sock") ||
      m.destination === "/" ||
      m.destination.startsWith("/home") ||
      m.destination.startsWith("/root")
    ) {
      problems.push(`montage sensible refusé: ${m.source} -> ${m.destination}`);
    }
  }

  if (problems.length > 0) {
    throw new SandboxSecurityError(
      `Conteneur de sandbox non conforme : ${problems.join(" ; ")}`,
    );
  }
}

/**
 * Vérifie l'état réseau effectif après un `network connect/disconnect`.
 * `docker inspect` conserve parfois l'ancien `NetworkMode` : la source de
 * vérité est la liste des réseaux réellement attachés.
 */
export function assertNetworkState(
  inspect: ContainerInspect,
  target: "none" | "egress",
  egressNetwork: string,
): void {
  const active = inspect.networks.filter((name) => name !== "none");
  if (active.includes("host")) {
    throw new SandboxSecurityError("Réseau host interdit dans la sandbox");
  }
  if (target === "none" && active.length > 0) {
    throw new SandboxSecurityError(
      `La sandbox est encore attachée à un réseau : ${active.join(", ")}`,
    );
  }
  if (target === "egress" && !inspect.networks.includes(egressNetwork)) {
    throw new SandboxSecurityError(
      `Réseau d'egress ${egressNetwork} absent après connexion`,
    );
  }
}

/**
 * Noms d'artefacts autorisés à revenir du conteneur vers le workspace hôte.
 * Cette liste est fermée : aucun chemin fourni par un dépôt n'est utilisé.
 */
export const ARTIFACT_ALLOWLIST = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "composer.lock",
  ".devsecops/pip-freeze.txt",
] as const;

export function assertSafeArtifactPath(artifact: string): string {
  const normalized = artifact.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.includes("..") ||
    /[\0\r\n]/.test(normalized) ||
    !ARTIFACT_ALLOWLIST.includes(
      normalized as (typeof ARTIFACT_ALLOWLIST)[number],
    )
  ) {
    throw new SandboxPathError(`Artefact non autorisé: ${artifact}`);
  }
  return normalized;
}

/** Valide une entrée de tar avant extraction sur l'hôte. */
export function isSafeTarEntryPath(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.startsWith("~")) {
    return false;
  }
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "")) return false;
  return true;
}

export function resolveArtifactLocalPath(
  workspaceDir: string,
  artifact: string,
): string {
  const safe = assertSafeArtifactPath(artifact);
  const target = path.resolve(workspaceDir, safe);
  const root = path.resolve(workspaceDir) + path.sep;
  if (!target.startsWith(root)) {
    throw new SandboxPathError(`Artefact hors workspace: ${artifact}`);
  }
  return target;
}

/** Masque les identifiants éventuels d'une URL avant de journaliser. */
export function redactCommandForLog(command: string): string {
  const redacted = command.replace(
    /(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
    "$1***:***@",
  );
  return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
}
