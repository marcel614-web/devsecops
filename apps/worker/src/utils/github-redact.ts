// apps/worker/src/utils/github-redact.ts

/**
 * Masque les tokens GitHub et autres credentials dans une chaîne.
 * Utilisé avant d'écrire dans les logs de pipeline.
 */

const REDACTED = "[REDACTED]";

// Patterns à masquer
const PATTERNS: RegExp[] = [
  // Tokens d'installation GitHub (ghs_)
  /\bghs_[A-Za-z0-9]{36,}\b/g,
  // Tokens utilisateur (ghp_, gho_)
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgho_[A-Za-z0-9]{20,}\b/g,
  /\bghu_[A-Za-z0-9]{20,}\b/g,
  // Tokens App (ghs_, ghr_)
  /\bghr_[A-Za-z0-9]{20,}\b/g,
  // PAT classique
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // Format URL avec token : https://x-access-token:ghs_xxx@github.com
  /https:\/\/x-access-token:[^@\s]+@github\.com/g,
  /https:\/\/[^:]+:[^@\s]+@github\.com/g,
  // Basic auth header
  /AUTHORIZATION: basic [A-Za-z0-9+/=]+/gi,
  // Clés PEM
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redactGithubSecrets(input: string): string {
  let output = input;
  for (const pattern of PATTERNS) {
    output = output.replace(pattern, REDACTED);
  }
  return output;
}