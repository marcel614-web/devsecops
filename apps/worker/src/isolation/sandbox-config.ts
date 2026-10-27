// apps/worker/src/isolation/sandbox-config.ts
import os from "node:os";
import path from "node:path";
import { FORBIDDEN_IN_CHILD_ENV } from "../utils/sandbox-env";

/**
 * Configuration de la sandbox d'exécution du code non fiable.
 *
 * Aucune valeur par défaut ne permet de retomber silencieusement sur une
 * exécution directe sur l'hôte du worker. Si aucun moteur Docker n'est
 * joignable, les étapes INSTALL_DEPS / TESTS échouent explicitement.
 */

export type SandboxBackendKind = "ssh-docker" | "local-docker";
export type SandboxTechnology = "NODEJS" | "PHP" | "PYTHON";
export type SandboxNetwork = "none" | "egress";

export interface SandboxLimits {
  /** Nombre de vCPU (peut être fractionnaire, ex. 1.5). */
  cpus: number;
  /** Mémoire RAM du conteneur, en Mo. */
  memoryMb: number;
  /** Limite de processus/threads (protection fork bomb). */
  pids: number;
  /** Taille du tmpfs /tmp, en Mo. */
  tmpfsMb: number;
  /** Taille maximale du workspace après installation, en Mo. */
  maxWorkspaceMb: number;
  /** Taille maximale de l'archive source envoyée, en Mo. */
  maxArchiveMb: number;
  /** Espace disque libre minimal exigé sur le moteur, en Mo. */
  minFreeDiskMb: number;
}

export interface SandboxSshConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  passphrase?: string;
  readyTimeoutMs: number;
}

export interface SandboxConfig {
  backend: "auto" | SandboxBackendKind;
  images: Record<SandboxTechnology, string>;
  limits: SandboxLimits;
  ssh: SandboxSshConfig | null;
  egressNetwork: string;
  installTimeoutMs: number;
  testTimeoutMs: number;
  uploadTimeoutMs: number;
  testNetwork: SandboxNetwork;
  orphanMaxAgeHours: number;
  workspaceRoot: string;
  /** Répertoire distant (ou local) racine des sandboxes. */
  remoteRoot: string;
}

export class SandboxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxConfigError";
  }
}

/** Même racine que celle utilisée par le moteur de pipeline. */
export const SANDBOX_WORKSPACES_ROOT = path.join(
  os.tmpdir(),
  "devsecops-workspaces",
);

function intEnv(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = source[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new SandboxConfigError(`${name} doit être un entier (reçu: ${raw})`);
  }
  if (parsed < min || parsed > max) {
    throw new SandboxConfigError(
      `${name} doit être compris entre ${min} et ${max} (reçu: ${parsed})`,
    );
  }
  return parsed;
}

function floatEnv(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = source[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new SandboxConfigError(`${name} doit être un nombre (reçu: ${raw})`);
  }
  if (parsed < min || parsed > max) {
    throw new SandboxConfigError(
      `${name} doit être compris entre ${min} et ${max} (reçu: ${parsed})`,
    );
  }
  return parsed;
}

function optionalString(
  source: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = source[name]?.trim();
  return value ? value : undefined;
}

/** Une référence d'image Docker ne doit jamais pouvoir injecter d'option. */
export function isValidImageRef(ref: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(ref) && !ref.includes("..");
}

function imageEnv(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const value = optionalString(source, name) ?? fallback;
  if (!isValidImageRef(value)) {
    throw new SandboxConfigError(
      `${name} n'est pas une référence d'image Docker valide: ${value}`,
    );
  }
  return value;
}

function networkName(source: NodeJS.ProcessEnv): string {
  const value = optionalString(source, "SANDBOX_EGRESS_NETWORK") ??
    "devsecops-sandbox-egress";
  // Un nom de réseau Docker est un identifiant simple : pas d'espaces ni de
  // métacaractères. Il est aussi utilisé dans `docker network connect`.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(value)) {
    throw new SandboxConfigError(
      `SANDBOX_EGRESS_NETWORK invalide: ${value}`,
    );
  }
  return value;
}

/**
 * Construit la configuration à partir de l'environnement.
 *
 * Lue à chaque appel (et non au chargement du module) pour que les tests et
 * les rechargements de configuration soient déterministes.
 */
export function loadSandboxConfig(
  source: NodeJS.ProcessEnv = process.env,
): SandboxConfig {
  const backendRaw = (optionalString(source, "SANDBOX_BACKEND") ?? "auto")
    .toLowerCase();
  if (!["auto", "ssh-docker", "local-docker"].includes(backendRaw)) {
    throw new SandboxConfigError(
      "SANDBOX_BACKEND doit valoir auto, ssh-docker ou local-docker " +
        `(reçu: ${backendRaw})`,
    );
  }

  const testNetworkRaw = (
    optionalString(source, "SANDBOX_TEST_NETWORK") ?? "none"
  ).toLowerCase();
  if (testNetworkRaw !== "none" && testNetworkRaw !== "egress") {
    throw new SandboxConfigError(
      "SANDBOX_TEST_NETWORK doit valoir none ou egress " +
        `(reçu: ${testNetworkRaw})`,
    );
  }

  const sshHost = optionalString(source, "SANDBOX_SSH_HOST");
  const sshUser = optionalString(source, "SANDBOX_SSH_USER");
  const sshKey = optionalString(source, "SANDBOX_SSH_KEY_PATH");
  const sshPort = intEnv(source, "SANDBOX_SSH_PORT", 22, 1, 65535);

  let ssh: SandboxSshConfig | null = null;
  if (sshHost || sshUser || sshKey) {
    if (!sshHost || !sshUser || !sshKey) {
      throw new SandboxConfigError(
        "Configuration SSH de sandbox incomplète : SANDBOX_SSH_HOST, " +
          "SANDBOX_SSH_USER et SANDBOX_SSH_KEY_PATH sont requis ensemble",
      );
    }
    ssh = {
      host: sshHost,
      port: sshPort,
      username: sshUser,
      privateKeyPath: sshKey,
      passphrase: optionalString(source, "SANDBOX_SSH_PASSPHRASE"),
      readyTimeoutMs: intEnv(
        source,
        "SANDBOX_SSH_READY_TIMEOUT_MS",
        30_000,
        1_000,
        120_000,
      ),
    };
  }

  const limits: SandboxLimits = {
    cpus: floatEnv(source, "SANDBOX_CPUS", 1, 0.1, 8),
    memoryMb: intEnv(source, "SANDBOX_MEMORY_MB", 2048, 128, 16384),
    pids: intEnv(source, "SANDBOX_PIDS", 512, 32, 8192),
    tmpfsMb: intEnv(source, "SANDBOX_TMPFS_MB", 1024, 16, 8192),
    maxWorkspaceMb: intEnv(source, "SANDBOX_MAX_WORKSPACE_MB", 2048, 64, 16384),
    maxArchiveMb: intEnv(source, "SANDBOX_MAX_ARCHIVE_MB", 512, 1, 8192),
    minFreeDiskMb: intEnv(source, "SANDBOX_MIN_FREE_DISK_MB", 1024, 0, 65536),
  };

  return {
    backend: backendRaw as SandboxConfig["backend"],
    images: {
      NODEJS: imageEnv(source, "SANDBOX_NODE_IMAGE", "node:24-alpine"),
      PYTHON: imageEnv(source, "SANDBOX_PYTHON_IMAGE", "python:3.12-slim"),
      PHP: imageEnv(source, "SANDBOX_PHP_IMAGE", "composer:2"),
    },
    limits,
    ssh,
    egressNetwork: networkName(source),
    installTimeoutMs: intEnv(
      source,
      "SANDBOX_INSTALL_TIMEOUT_MS",
      15 * 60_000,
      30_000,
      60 * 60_000,
    ),
    testTimeoutMs: intEnv(
      source,
      "SANDBOX_TEST_TIMEOUT_MS",
      15 * 60_000,
      10_000,
      60 * 60_000,
    ),
    uploadTimeoutMs: intEnv(
      source,
      "SANDBOX_UPLOAD_TIMEOUT_MS",
      10 * 60_000,
      30_000,
      60 * 60_000,
    ),
    testNetwork: testNetworkRaw as SandboxNetwork,
    orphanMaxAgeHours: intEnv(
      source,
      "SANDBOX_ORPHAN_MAX_AGE_HOURS",
      12,
      1,
      24 * 30,
    ),
    workspaceRoot: SANDBOX_WORKSPACES_ROOT,
    remoteRoot: "/tmp/devsecops-sandbox",
  };
}

/**
 * Détermine le backend effectif.
 *
 * En mode `auto`, une configuration SSH explicite est prioritaire : c'est le
 * cas du laboratoire, où le worker Windows n'a pas de moteur Docker local.
 * Sinon on tente Docker local (et l'absence du binaire produit une erreur
 * explicite, jamais une exécution sur l'hôte).
 */
export function resolveSandboxBackendKind(
  config: SandboxConfig,
): SandboxBackendKind {
  if (config.backend === "ssh-docker" || config.backend === "local-docker") {
    return config.backend;
  }
  return config.ssh ? "ssh-docker" : "local-docker";
}

/**
 * Variables d'environnement de plateforme qui ne doivent JAMAIS être
 * transmises au conteneur, même si un appelant les ajoute explicitement.
 */
export const FORBIDDEN_SANDBOX_ENV: readonly string[] = [
  ...FORBIDDEN_IN_CHILD_ENV,
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "DOCKER_HOST",
  "DOCKER_CONFIG",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AZURE_CLIENT_SECRET",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "COMPOSER_AUTH",
];

function isForbidden(name: string): boolean {
  const upper = name.toUpperCase();
  return FORBIDDEN_SANDBOX_ENV.some((key) => key.toUpperCase() === upper);
}

function safeUrlWithoutCredentials(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function safeMultiUrl(value: string): string | undefined {
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  const sanitized = parts.map(safeUrlWithoutCredentials);
  return sanitized.every((part) => part !== undefined)
    ? sanitized.join(" ")
    : undefined;
}

/**
 * Construit l'environnement minimal du conteneur.
 *
 * Aucun `process.env` complet n'est copié. Les URL de miroirs sont acceptées
 * uniquement sans identifiants (`https://user:token@...` est refusé), pour
 * éviter d'exfiltrer un jeton de registre dans une commande de dépôt.
 */
export function buildSandboxExecEnv(
  source: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string | undefined> = {},
): Record<string, string> {
  const env: Record<string, string> = {
    HOME: "/tmp",
    TMPDIR: "/tmp",
    TMP: "/tmp",
    CI: "true",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    SHELL: "/bin/sh",
    NPM_CONFIG_CACHE: "/tmp/npm-cache",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_PREFER_OFFLINE: "false",
    PIP_CACHE_DIR: "/tmp/pip-cache",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_NO_INPUT: "1",
    COMPOSER_HOME: "/tmp/composer",
    COMPOSER_CACHE_DIR: "/tmp/composer/cache",
  };

  const forwarded: Array<[string, (v: string) => string | undefined]> = [
    ["PIP_INDEX_URL", safeUrlWithoutCredentials],
    ["PIP_EXTRA_INDEX_URL", safeMultiUrl],
    [
      "PIP_TRUSTED_HOST",
      (v) =>
        /^[a-zA-Z0-9][a-zA-Z0-9._-]*(?::[0-9]{1,5})?$/.test(v) ? v : undefined,
    ],
    ["PIP_RETRIES", (v) => (/^[0-9]{1,3}$/.test(v) ? v : undefined)],
    ["PIP_DEFAULT_TIMEOUT", (v) => (/^[0-9]{1,4}$/.test(v) ? v : undefined)],
    ["NPM_CONFIG_REGISTRY", safeUrlWithoutCredentials],
    [
      "NPM_CONFIG_LOGLEVEL",
      (v) =>
        ["silent", "error", "warn", "http", "info", "verbose", "silly"].includes(v)
          ? v
          : undefined,
    ],
  ];

  for (const [name, sanitize] of forwarded) {
    const raw = source[name];
    if (raw === undefined || raw.trim() === "") continue;
    const value = sanitize(raw.trim());
    if (value !== undefined) env[name] = value;
  }

  // Valeurs de résilience réseau par défaut, surchargeables par l'appelant
  // ou par l'environnement (les arguments pip explicites restent prioritaires).
  if (!env.PIP_RETRIES) env.PIP_RETRIES = "5";
  if (!env.PIP_DEFAULT_TIMEOUT) env.PIP_DEFAULT_TIMEOUT = "60";

  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new SandboxConfigError(
        `Nom de variable d'environnement invalide: ${name}`,
      );
    }
    if (isForbidden(name)) {
      throw new SandboxConfigError(
        `Variable d'environnement interdite dans la sandbox: ${name}`,
      );
    }
    if (value.includes("\0")) {
      throw new SandboxConfigError(
        `Valeur d'environnement invalide (NUL) pour ${name}`,
      );
    }
    if (value.length > 4096) {
      throw new SandboxConfigError(
        `Valeur d'environnement trop longue pour ${name}`,
      );
    }
    env[name] = value;
  }

  return env;
}
