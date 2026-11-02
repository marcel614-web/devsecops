// packages/shared/src/ssh-host-key.ts
import crypto from "node:crypto";

/**
 * Empreinte d'une clé d'hôte SSH au format OpenSSH :
 *   SHA256:<base64 sans padding>
 *
 * On n'utilise volontairement pas `ssh-keyscan` : la vérification doit se
 * faire sur la clé réellement présentée pendant le handshake, pas sur une
 * valeur obtenue par une commande shell séparée.
 */
export function computeHostKeyFingerprint(key: Buffer | Uint8Array): string {
  const digest = crypto.createHash("sha256").update(Buffer.from(key)).digest("base64");
  return `SHA256:${digest.replace(/=+$/u, "")}`;
}

export function normalizeHostKeyFingerprint(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  // SHA-256 = 32 octets, soit exactement 43 caractères base64 sans padding.
  const match = /^SHA256:([A-Za-z0-9+/]{43})$/u.exec(trimmed.replace(/=+$/u, ""));
  if (!match) return null;
  return `SHA256:${match[1]}`;
}

export function isValidHostKeyFingerprint(value: string | null | undefined): boolean {
  return normalizeHostKeyFingerprint(value) !== null;
}

/** Comparaison à temps constant de deux empreintes normalisées. */
export function hostKeyMatches(
  observed: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  const a = normalizeHostKeyFingerprint(observed);
  const b = normalizeHostKeyFingerprint(expected);
  if (!a || !b) return false;

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Échoue explicitement si la clé présentée ne correspond pas à la référence
 * de confiance. Aucun mode « accepter à l'aveugle » n'est prévu.
 */
export function assertHostKeyTrusted(
  observed: string | null | undefined,
  expected: string | null | undefined,
  host?: string,
): void {
  if (!normalizeHostKeyFingerprint(expected)) {
    throw new Error(
      `Clé d'hôte SSH non configurée pour ${host ?? "ce serveur"} : ` +
        "enregistrez d'abord son empreinte de confiance.",
    );
  }

  if (!hostKeyMatches(observed, expected)) {
    throw new Error(
      `Clé d'hôte SSH inconnue ou modifiée pour ${host ?? "ce serveur"} ` +
        `(observée : ${observed ?? "aucune"}, attendue : ${expected}). ` +
        "Connexion refusée.",
    );
  }
}
