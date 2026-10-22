// packages/shared/src/secrets.ts
import { z } from "zod";

/**
 * Validation des secrets — partagée entre l'API et le worker.
 *
 * Objectif : empêcher qu'une valeur de démonstration (issue de
 * `.env.example`, donc publique dans le dépôt) ne soit utilisée pour
 * signer des JWT ou chiffrer des secrets en base.
 */

/** Longueur minimale d'un secret symétrique (en caractères). */
export const MIN_SECRET_LENGTH = 32;

/**
 * Motifs de valeurs de démonstration / placeholder.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^changeme/i,
  /^change[-_]?me/i,
  /change[-_]?me/i,
  /^placeholder/i,
  /^example/i,
  /^your[-_]/i,
  /^dummy/i,
  /^todo/i,
  /^replace[-_]?me/i,
  /^inserer[-_]/i,
];

/**
 * Décode une chaîne base64 si elle l'est vraiment et si le résultat est
 * lisible (ASCII imprimable). Retourne null sinon.
 */
function decodeBase64IfPossible(value: string): string | null {
  if (value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!/^[\x20-\x7e]+$/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Indique si une valeur ressemble à un placeholder connu (ex.
 * `changeme-at-least-32-characters-long`).
 *
 * On teste aussi la valeur ** décodée en base64** : la clé maîtresse de
 * développement historique est stockée en base64
 * (`ZGV2LW1hc3Rlci1rZXktMzItYnl0ZXMtY2hhbmdlLW1l`), donc les motifs
 * littéraux ne la détectent pas.
 */
export function isPlaceholderSecret(value: string): boolean {
  const raw = value.trim();
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(raw))) return true;

  const decoded = decodeBase64IfPossible(raw);
  if (decoded && PLACEHOLDER_PATTERNS.some((re) => re.test(decoded))) {
    return true;
  }
  return false;
}

/**
 * Champ de secret Zod : longueur minimale + refus des placeholders.
 */
export function secretField(label: string) {
  return z
    .string({ required_error: `${label} est requis` })
    .min(
      MIN_SECRET_LENGTH,
      `${label} doit contenir au moins ${MIN_SECRET_LENGTH} caractères`,
    )
    .refine(
      (v) => !isPlaceholderSecret(v),
      `${label} ne doit pas utiliser une valeur de démonstration (ex. "changeme-..."). Générez une valeur aléatoire.`,
    );
}
