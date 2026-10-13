// apps/api/src/utils/redact.ts

/**
 * Utilitaire de masquage des secrets dans les logs.
 * Règle DevSecOps : aucun secret ne doit JAMAIS apparaître en clair dans les logs.
 *
 * On masque :
 *  - les chaînes qui ressemblent à des tokens (ghp_, gho_, github_pat_, sk-, etc.)
 *  - les clés PEM (-----BEGIN ... PRIVATE KEY-----)
 *  - les entrées dont la clé contient "password", "secret", "token", "key"
 *  - les valeurs de l'objet env sensibles
 */

const REDACTED = "[REDACTED]";

// Clés d'objet dont la valeur doit toujours être masquée (insensible à la casse).
const SENSITIVE_KEYS = [
  "password",
  "passwordhash",
  "passwd",
  "passphrase",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "access_token",
  "refresh_token",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "authorization",
  "cookie",
  "set-cookie",
  "sshkey",
  "ssh_key",
  "clientsecret",
  "client_secret",
  "webhooksecret",
  "webhook_secret",
  "masterkey",
  "master_key",
  "encryptionkey",
  "encryption_key",
];

// Motifs de chaînes ressemblant à des secrets.
const SECRET_PATTERNS: RegExp[] = [
  // GitHub tokens
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgho_[A-Za-z0-9]{20,}\b/g,
  /\bghs_[A-Za-z0-9]{20,}\b/g,
  /\bghu_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // OpenAI / Anthropic style
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9-]{20,}\b/g,
  // AWS
  /\bAKIA[0-9A-Z]{16}\b/g,
  // JWT
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // Clés PEM
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
];

/**
 * Masque une chaîne en clair.
 */
export function redactString(input: string): string {
  let output = input;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, REDACTED);
  }
  return output;
}

/**
 * Masque récursivement un objet/tableau.
 * - Les clés sensibles → valeur remplacée par [REDACTED]
 * - Les chaînes → passage par redactString
 * - Profondeur limitée pour éviter les boucles infinies
 */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return "[MAX_DEPTH]" as unknown as T;

  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return redactString(value) as unknown as T;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1)) as unknown as T;
  }

  if (typeof value === "object") {
    // Gestion spéciale des Error : on garde message + name, on masque stack.
    if (value instanceof Error) {
      const err = value as Error & { code?: string };
      return {
        name: err.name,
        message: redactString(err.message ?? ""),
        code: err.code,
      } as unknown as T;
    }

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.includes(lowerKey)) {
        result[key] = REDACTED;
      } else {
        result[key] = redact(val, depth + 1);
      }
    }
    return result as unknown as T;
  }

  return value;
}