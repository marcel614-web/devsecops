
// apps/api/src/secrets/crypto.ts
import crypto from "node:crypto";
import { env } from "../config/env";

/**
 * Chiffrement symétrique AES-256-GCM.
 * Format du ciphertext : base64(iv[12] || authTag[16] || ciphertext)
 *
 * La clé maître provient de MASTER_ENCRYPTION_KEY. Elle est normalisée
 * à 32 octets via SHA-256 pour accepter n'importe quelle longueur d'entrée.
 */
const KEY = crypto.createHash("sha256").update(env.MASTER_ENCRYPTION_KEY).digest();

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

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

export function decryptString(ciphertext: string): string {
  const raw = Buffer.from(ciphertext, "base64");
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Ciphertext invalide");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Empreinte non réversible d'une clé privée, utile pour l'affichage
 * ("empreinte SHA-256 : a1:b2:...") sans jamais exposer la clé.
 */
export function fingerprint(input: string): string {
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  return hash.match(/.{1,2}/g)?.slice(0, 8).join(":").toUpperCase() ?? hash;
}