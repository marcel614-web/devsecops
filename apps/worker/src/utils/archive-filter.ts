// apps/worker/src/utils/archive-filter.ts
/**
 * Filtre d'archive partagé par le build Docker et la sandbox.
 *
 * Les deux usages envoient le contenu d'un dépôt non fiable vers une autre
 * machine. Le filtre doit donc rester volontairement conservateur : aucun
 * secret local (`.env`, clés privées, credentials), aucun historique Git,
 * aucun répertoire de dépendances ou de cache.
 *
 * Il est extrait ici pour éviter que les deux chemins d'archivage divergent
 * avec le temps : une exclusion ajoutée pour la sandbox doit aussi protéger
 * l'image Docker, et inversement.
 */

/** Répertoires qui ne doivent PAS être envoyés à la VM. */
const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  ".parcel-cache",
  ".venv",
  "venv",
  "__pycache__",
  "vendor",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "coverage",
  ".nyc_output",
  ".idea",
  ".vscode",
  ".ssh",
  ".aws",
  ".azure",
  ".kube",
];

/** Fichiers individuels à exclure (nom exact du fichier). */
const EXCLUDED_FILES = [".DS_Store", "Thumbs.db"];

/**
 * Modèles d'environnement qui ne contiennent pas de secret réel.
 * Ils restent utiles au build (ex. valeurs par défaut documentées).
 */
const SAFE_ENV_TEMPLATES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.dist",
]);

/**
 * Motifs de fichiers sensibles qui ne doivent JAMAIS quitter le worker.
 * On reste conservateur : les fichiers de configuration versionnés
 * (ex. `config.example.json`) ne sont pas touchés.
 */
const EXCLUDED_SECRET_PATTERNS: RegExp[] = [
  /^\.env$/i,
  /^\.env\..+$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /\.keystore$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /^credentials(\.json)?$/i,
  /\.dump$/i,
];

/**
 * Filtre utilisé par `tar.create`. Retourne `true` pour inclure le chemin,
 * `false` pour l'exclure.
 *
 * Exporté pour être testé directement : c'est une barrière de sécurité.
 */
export function shouldIncludePath(entryPath: string): boolean {
  // Normalise les séparateurs (Windows → Unix)
  const normalized = entryPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "." || normalized === "") return true;

  // Exclut les fichiers journaux
  if (normalized.endsWith(".log")) return false;

  const parts = normalized.split("/");
  const basename = parts[parts.length - 1] ?? "";

  // Archive temporaire de rapatriement des artefacts : elle est supprimée
  // normalement, mais ne doit jamais finir dans un contexte de build.
  if (/^\.devsecops-artifacts-[0-9a-f-]+\.tar\.gz$/i.test(basename)) {
    return false;
  }

  // Exclut les noms de fichiers individuels
  if (EXCLUDED_FILES.includes(basename)) return false;

  // Les modèles d'environnement ne contiennent pas de secret réel.
  if (SAFE_ENV_TEMPLATES.has(basename.toLowerCase())) return true;

  // Exclut les secrets et matériaux cryptographiques
  if (EXCLUDED_SECRET_PATTERNS.some((pattern) => pattern.test(basename))) {
    return false;
  }

  // Exclut si un des segments du chemin est dans EXCLUDED_DIRS
  // (comparaison insensible à la casse : un dépôt peut contenir `.SSH`).
  for (const part of parts) {
    if (EXCLUDED_DIRS.includes(part.toLowerCase())) return false;
  }

  return true;
}

/**
 * Un dépôt peut contenir des liens symboliques (ou des liens durs) vers des
 * chemins de l'hôte. On refuse ces entrées à l'archivage : elles n'ont pas
 * de raison d'être dans une image ou une sandbox, et elles constituent un
 * vecteur classique d'exfiltration.
 */
export function isSafeArchiveEntryType(type: string | undefined): boolean {
  // Seuls les fichiers et répertoires ordinaires sont acceptés. Les liens
  // symboliques/durs, FIFOs et périphériques n'ont aucune raison d'être dans
  // une archive de dépôt et constituent des vecteurs d'évasion.
  return type === "File" || type === "Directory";
}
