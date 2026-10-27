// apps/worker/src/isolation/sandbox-errors.ts

/** Erreur de base : la sandbox n'a pas pu exécuter l'opération. */
export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

/**
 * Aucun moteur/runner exploitable. Cet échec est volontairement explicite :
 * il ne doit jamais déclencher une exécution sur l'hôte du worker.
 */
export class SandboxUnavailableError extends SandboxError {
  constructor(message: string) {
    super(message);
    this.name = "SandboxUnavailableError";
  }
}

/** L'image de base requise n'est pas présente sur le moteur. */
export class SandboxImageMissingError extends SandboxUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = "SandboxImageMissingError";
  }
}

/** Limite de temps dépassée ; le conteneur doit être détruit. */
export class SandboxTimeoutError extends SandboxError {
  constructor(message: string) {
    super(message);
    this.name = "SandboxTimeoutError";
  }
}

/** Annulation demandée par l'utilisateur ; le conteneur doit être détruit. */
export class SandboxCancelledError extends SandboxError {
  constructor(message = "Exécution annulée") {
    super(message);
    this.name = "SandboxCancelledError";
  }
}

/** Limite de ressources (mémoire, disque, taille du workspace). */
export class SandboxLimitError extends SandboxError {
  constructor(message: string) {
    super(message);
    this.name = "SandboxLimitError";
  }
}

/** La commande s'est exécutée mais a retourné un code non nul. */
export class SandboxCommandError extends SandboxError {
  constructor(
    readonly label: string,
    readonly result: {
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs?: number;
    },
  ) {
    super(`${label} a échoué avec le code ${result.exitCode}`);
    this.name = "SandboxCommandError";
  }
}

/** Erreur interne d'abandon (signal), traduite par la session. */
export class SandboxAbortError extends SandboxError {
  constructor(
    message: string,
    readonly reason: "timeout" | "cancelled" = "cancelled",
  ) {
    super(message);
    this.name = "SandboxAbortError";
  }
}

export function isSandboxAbort(err: unknown): err is SandboxAbortError {
  return err instanceof SandboxAbortError;
}
