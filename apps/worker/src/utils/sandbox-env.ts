// apps/worker/src/utils/sandbox-env.ts
/**
 * Environnement minimal pour les processus enfants.
 *
 * PROBLÈME CORRIGÉ : le worker passait `{ ...process.env }` aux commandes
 * lancées dans le workspace du dépôt cloné (`npm ci`, `npm test`,
 * `composer install`, `pip install`...). Le script `test` du dépôt — code
 * totalement non fiable — recevait donc :
 *
 *   - DATABASE_URL          (accès complet à la base)
 *   - MASTER_ENCRYPTION_KEY (déchiffrement de toutes les clés SSH / tokens)
 *   - JWT_ACCESS_SECRET / JWT_REFRESH_SECRET (forge de jetons)
 *   - GITHUB_APP_PRIVATE_KEY, GITHUB_CLIENT_SECRET, ...
 *
 * Avec `isolation/sandbox.ts` vide (pas de conteneur, pas de namespace),
 * un dépôt malveillant pouvait exfiltrer la plateforme entière.
 *
 * CORRECTIF : on construit une allow-list stricte. Seules les variables
 * nécessaires au fonctionnement de l'outil sont transmises.
 */

/**
 * Variables transmises telles quelles aux processus enfants.
 * Ce sont des variables "de build" ou propres à un outil, sans secret
 * de plateforme.
 */
const ALLOWED_PASSTHROUGH = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMDATA",
  "COMSPEC",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TZ",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "CI",
  "PYTHONPATH",
  "PYTHONHOME",
  "VIRTUAL_ENV",
  "CONDA_PREFIX",
  "NODE_OPTIONS",
  "NVM_DIR",
  "GOPATH",
  "GOROOT",
  "JAVA_HOME",
  "MAVEN_HOME",
  "GIT_TERMINAL_PROMPT",
  "GIT_SSH_COMMAND",
  "GIT_CONFIG_NOSYSTEM",
  "SSH_AUTH_SOCK",
  "DOCKER_HOST",
  "DOCKER_CONFIG",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
  "COMPOSER_HOME",
  "COMPOSER_CACHE_DIR",
  "PIP_CACHE_DIR",
  "PIP_DISABLE_PIP_VERSION_CHECK",
  "PIP_NO_INPUT",
  "npm_config_cache",
  "npm_config_registry",
  "NPM_CONFIG_USERCONFIG",
  "NPM_CONFIG_LOGLEVEL",
  "GITLEAKS_BIN",
  "TRIVY_BIN",
  "TRIVY_CACHE_DIR",
  "SEMGREP_BIN",
  "ZAP_BIN",
  "ZAP_HOME",
  "ZAP_IMAGE",
  "SYFT_IMAGE",
  "COSIGN_IMAGE",
  "TRIVY_VM_IMAGE",
  "TRIVY_VM_CACHE_VOLUME",
  "PYTHON_BIN",
  "COMPOSER_BIN",
  "PIP_AUDIT_BIN",
  "NPM_BIN",
] as const;

/**
 * Variables calculées à partir de l'environnement, mais SÛRES.
 */
const DERIVED: Array<{
  name: string;
  compute: (source: NodeJS.ProcessEnv) => string | undefined;
}> = [
  { name: "CI", compute: () => "true" },
  { name: "npm_config_yes", compute: () => "true" },
  { name: "PIP_DISABLE_PIP_VERSION_CHECK", compute: () => "1" },
  { name: "GIT_TERMINAL_PROMPT", compute: () => "0" },
  {
    name: "GITHUB_TOKEN",
    compute: () => undefined, // jamais transmis
  },
];

/**
 * Construit l'environnement d'un processus enfant.
 *
 * La lecture dans l'environnement source est **insensible à la casse** :
 * sur Windows, `process.env.SystemRoot` et `process.env.SYSTEMROOT` sont
 * la même variable, mais un objet JavaScript les distingue. Sans cette
 * normalisation, `SystemRoot` (indispensable pour spawn un processus sous
 * Windows) disparaissait de l'environnement enfant.
 *
 * @param source  environnement parent (par défaut `process.env`)
 * @param extra   variables supplémentaires autorisées explicitement
 *                (ex. `NPM_CONFIG_CACHE` pour pointer un cache local)
 */
export function buildSandboxEnv(
  source: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  // Index insensible à la casse de l'environnement source.
  const index = new Map<string, string>();
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) index.set(key.toLowerCase(), value);
  }

  const result: NodeJS.ProcessEnv = {};

  for (const name of ALLOWED_PASSTHROUGH) {
    const value = index.get(name.toLowerCase());
    if (value !== undefined) result[name] = value;
  }

  for (const { name, compute } of DERIVED) {
    const value = compute(source);
    if (value !== undefined) result[name] = value;
  }

  for (const [name, value] of Object.entries(extra)) {
    if (value !== undefined) result[name] = value;
  }

  return result;
}

/**
 * Liste des secrets de plateforme qui ne doivent JAMAIS sortir du worker.
 * Utilisée par les tests et par une assertion de sécurité.
 */
export const FORBIDDEN_IN_CHILD_ENV = [
  "DATABASE_URL",
  "MASTER_ENCRYPTION_KEY",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_WEBHOOK_SECRET",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_APP_CLIENT_SECRET",
  "REDIS_PASSWORD",
  "COSIGN_PASSWORD",
  "COSIGN_REGISTRY_PASSWORD",
] as const;
