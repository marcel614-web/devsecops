// apps/worker/src/utils/crypto.ts
import crypto from "node:crypto";
import { env } from "../config/env";

/**
 * Chiffrement symétrique AES-256-GCM (compatible avec le backend API).
 * Format du ciphertext : base64(iv[12] || authTag[16] || ciphertext)
 *
 * La clé maître provient de MASTER_ENCRYPTION_KEY et est normalisée
 * à 32 octets via SHA-256 (identique au backend).
 */

const KEY = crypto
  .createHash("sha256")
  .update(env.MASTER_ENCRYPTION_KEY)
  .digest();

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Déchiffre une chaîne précédemment chiffrée par le backend.
 */
export function decryptString(ciphertext: string): string {
  const raw = Buffer.from(ciphertext, "base64");
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Ciphertext invalide (trop court)");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Chiffre une chaîne (symétrique du backend).
 * Utilisé côté worker si on doit stocker des secrets temporaires.
 */
export function encryptString(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/**
 * Empreinte SHA-256 tronquée (utile pour logger une clé sans l'exposer).
 */
export function fingerprint(input: string): string {
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  return hash.match(/.{1,2}/g)?.slice(0, 8).join(":").toUpperCase() ?? hash;
}