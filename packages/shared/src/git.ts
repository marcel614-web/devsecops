// packages/shared/src/git.ts
/**
 * Validation des références Git.
 *
 * Le SHA de commit est utilisé pour construire le tag Docker
 * (`devsecops/<projectId>:<sha>`), qui part ensuite dans une commande
 * shell exécutée sur la VM de déploiement. Sans validation stricte, une
 * valeur contenant `"` ou `$(...)` permettait l'exécution de commandes
 * arbitraires sur le serveur de production.
 */

/** SHA Git hexadécimal (7 à 40 caractères, comme `git rev-parse --short`). */
export const GIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * SHA de substitution utilisé par l'API quand l'utilisateur ne fournit
 * pas de commit : `manual-<epoch ms>`. Réservé à un usage interne.
 */
export const MANUAL_SHA_PATTERN = /^manual-[0-9]{10,20}$/;

/**
 * Indique si une valeur est un SHA Git acceptable.
 */
export function isValidGitSha(value: string): boolean {
  const raw = value.trim();
  return GIT_SHA_PATTERN.test(raw) || MANUAL_SHA_PATTERN.test(raw);
}

/**
 * Normalise un SHA : met en minuscules les SHA hexadécimaux.
 * Lève une erreur si la valeur n'est pas acceptable.
 */
export function assertValidGitSha(value: string): string {
  const raw = value.trim();
  if (!isValidGitSha(raw)) {
    throw new Error(
      `SHA de commit invalide : "${raw}". Attendu : 7 à 40 caractères hexadécimaux.`,
    );
  }
  return GIT_SHA_PATTERN.test(raw) ? raw.toLowerCase() : raw;
}
