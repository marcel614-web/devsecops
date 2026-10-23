// packages/shared/src/network-errors.ts
/**
 * Détection des erreurs réseau transitoires.
 *
 * Le worker et les scanners appellent des registres et des API publiques
 * (PyPI, OSV, Docker Hub, Maven Central...) depuis un réseau parfois
 * instable : coupures Wi-Fi, DNS qui expire, timeouts TLS. Une nouvelle
 * tentative suffit le plus souvent, alors qu'une erreur fonctionnelle
 * (version inexistante, build cassé) ne doit jamais être rejouée.
 *
 * Ce module ne contient aucun secret et peut être utilisé partout.
 */

const TRANSIENT_NETWORK_PATTERNS: RegExp[] = [
  // Résolution DNS
  /getaddrinfo failed/i,
  /temporary failure in name resolution/i,
  /name or service not known/i,
  /nodename nor servname provided/i,
  /no address associated with hostname/i,
  /could not resolve host/i,
  /EAI_AGAIN/,
  /ENOTFOUND/,
  // Délais d'attente
  /timed out/i,
  /timeout/i,
  /ETIMEDOUT/,
  /ESOCKETTIMEDOUT/,
  // Connexion coupée / refusée / instable
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ECONNABORTED/,
  /EPIPE/,
  /connection reset by peer/i,
  /connection aborted/i,
  /connection refused/i,
  /incompleteread/i,
  /remotedisconnected/i,
  /broken pipe/i,
  /network is unreachable/i,
  /ENETUNREACH/,
  /EHOSTUNREACH/,
  /newconnectionerror/i,
  /failed to establish a new connection/i,
  /max retries exceeded/i,
  /proxyerror/i,
  /sslerror/i,
  /tlsv1 alert/i,
  /eof occurred in violation of protocol/i,
  // Erreurs HTTP transitoires des registres
  /http(?: error)? 50[234]/i,
  /status(?:_code| code)?[ =:]+50[234]/i,
];

export type ExecLikeError = {
  code?: number | string;
  message?: string;
  stdout?: string;
  stderr?: string;
};

/**
 * Indique si une erreur d'exécution ressemble à une panne réseau
 * intermittente (DNS, timeout, connexion coupée).
 */
export function isTransientNetworkError(err: unknown): boolean {
  const candidate = (err ?? {}) as ExecLikeError;
  const haystack = [candidate.message, candidate.stdout, candidate.stderr]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  return TRANSIENT_NETWORK_PATTERNS.some((pattern) => pattern.test(haystack));
}

/** Message lisible pour les logs (sans exposer la sortie complète). */
export function describeExecError(err: unknown): string {
  const candidate = (err ?? {}) as ExecLikeError;
  const stderr = candidate.stderr?.trim();
  if (stderr) return stderr.slice(-2000);
  if (candidate.message) return candidate.message;
  return "erreur inconnue";
}
