// apps/worker/src/runners/ssh.runner.ts
import {
  Client,
  type ClientChannel,
  type ConnectConfig,
  type SFTPWrapper,
} from "ssh2";
import path from "node:path";
import {
  computeHostKeyFingerprint,
  hostKeyMatches,
  normalizeHostKeyFingerprint,
} from "@devsecops/shared";
import { logger } from "../utils/logger";

export interface SshConnectOptions {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  passphrase?: string;
  readyTimeoutMs?: number;
  /**
   * Référence de confiance de la clé d'hôte (`SHA256:...`). Obligatoire :
   * une valeur absente provoque un refus explicite, jamais une connexion
   * sans vérification.
   */
  hostKeyFingerprint?: string | null;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class SshRunner {
  private conn: Client | null = null;
  /** Empreinte réellement observée pendant le dernier handshake. */
  public lastHostKeyFingerprint: string | null = null;

  async connect(opts: SshConnectOptions): Promise<void> {
    const expected = normalizeHostKeyFingerprint(opts.hostKeyFingerprint);
    if (!expected) {
      throw new Error(
        `Clé d'hôte SSH non configurée pour ${opts.host}:${opts.port} : ` +
          "enregistrez son empreinte de confiance avant tout déploiement.",
      );
    }

    let hostKeyError: string | null = null;

    const config: ConnectConfig = {
      host: opts.host,
      port: opts.port,
      username: opts.username,
      privateKey: opts.privateKey,
      passphrase: opts.passphrase,
      readyTimeout: opts.readyTimeoutMs ?? 20_000,
      keepaliveInterval: 30_000,
      hostVerifier: (key: Buffer) => {
        const observed = computeHostKeyFingerprint(key);
        this.lastHostKeyFingerprint = observed;
        const ok = hostKeyMatches(observed, expected);
        if (!ok) {
          hostKeyError =
            `Clé d'hôte SSH inconnue ou modifiée pour ${opts.host}:${opts.port} ` +
            `(observée : ${observed}, attendue : ${expected}). Connexion refusée.`;
          logger.warn(
            { host: opts.host, port: opts.port, observed, expected },
            "Clé d'hôte SSH refusée",
          );
        }
        return ok;
      },
    };

    const conn = new Client();
    this.conn = conn;
    let ready = false;

    await new Promise<void>((resolve, reject) => {
      // Ce gestionnaire reste attache apres le handshake : sans lui, une
      // coupure reseau ulterieure emet un evenement `error` non gere et tue
      // tout le processus Node (donc le worker et les jobs en cours).
      conn.on("error", (err) => {
        if (!ready) {
          reject(
            new Error(
              hostKeyError ?? `SSH ${opts.host}:${opts.port} — ${err.message}`,
            ),
          );
          return;
        }
        logger.warn(
          { host: opts.host, port: opts.port, error: err.message },
          "Connexion SSH perdue",
        );
      });
      conn.once("ready", () => {
        ready = true;
        resolve();
      });
      try {
        conn.connect(config);
      } catch (err) {
        reject(err);
      }
    }).catch((err) => {
      conn.end();
      if (this.conn === conn) this.conn = null;
      throw err;
    });

    logger.debug(
      {
        host: opts.host,
        user: opts.username,
        hostKeyFingerprint: this.lastHostKeyFingerprint,
      },
      "SSH connecté (clé d'hôte vérifiée)",
    );
  }

  async exec(command: string, timeoutMs = 5 * 60_000): Promise<ExecResult> {
    if (!this.conn) throw new Error("SSH non connecté");

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      let stream: ClientChannel | null = null;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        fn();
      };

      timer = setTimeout(() => {
        try {
          stream?.close();
        } catch {
          // canal déjà fermé
        }
        finish(() =>
          reject(
            new Error(`Timeout SSH (${timeoutMs}ms) : ${command.slice(0, 80)}`),
          ),
        );
      }, timeoutMs);

      this.conn!.exec(command, (err, channel) => {
        if (err) {
          finish(() => reject(err));
          return;
        }
        stream = channel;

        let stdout = "";
        let stderr = "";

        channel.on("data", (data: Buffer) => {
          stdout += data.toString("utf8");
        });
        channel.stderr.on("data", (data: Buffer) => {
          stderr += data.toString("utf8");
        });
        channel.on("error", (error: Error) => {
          finish(() => reject(new Error(`Erreur du flux SSH : ${error.message}`)));
        });
        channel.on("close", (code: number) => {
          finish(() => resolve({ stdout, stderr, code: code ?? 0 }));
        });
      });
    });
  }

  /**
   * Exécute une commande et stream les lignes en temps réel.
   * Retourne le code de sortie.
   */
  async execStream(
    command: string,
    onData: (chunk: string, stream: "stdout" | "stderr") => void,
    timeoutMs = 10 * 60_000,
    signal?: AbortSignal,
  ): Promise<number> {
    if (!this.conn) throw new Error("SSH non connecté");

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      let channel: ClientChannel | null = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        signal?.removeEventListener("abort", onAbort);
      };

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const onAbort = () => {
        try {
          channel?.close();
        } catch {
          // Le canal est peut-être déjà fermé.
        }
        const err = new Error("SSH stream aborted");
        err.name = "AbortError";
        finish(() => reject(err));
      };

      timer = setTimeout(() => {
        try {
          channel?.close();
        } catch {
          // ignore
        }
        finish(() =>
          reject(
            new Error(
              `Timeout SSH stream (${timeoutMs}ms) : ${command.slice(0, 80)}`,
            ),
          ),
        );
      }, timeoutMs);

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });

      this.conn!.exec(command, (err, stream) => {
        if (err) {
          finish(() => reject(err));
          return;
        }
        channel = stream;

        stream.on("data", (data: Buffer) =>
          onData(data.toString("utf8"), "stdout"),
        );
        stream.stderr.on("data", (data: Buffer) =>
          onData(data.toString("utf8"), "stderr"),
        );
        stream.on("error", (err: Error) => {
          finish(() => reject(new Error(`Erreur du flux SSH : ${err.message}`)));
        });
        stream.on("close", (code: number) => {
          finish(() => resolve(code ?? 0));
        });
      });
    });
  }

  /**
   * Upload un fichier local vers un chemin distant via SFTP.
   */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    if (!this.conn) throw new Error("SSH non connecté");

    const sftp: SFTPWrapper = await new Promise((resolve, reject) => {
      this.conn!.sftp((err, sftp) => {
        if (err) return reject(err);
        resolve(sftp);
      });
    });

    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, {}, (err) => {
        sftp.end();
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * Télécharge un fichier distant vers un chemin local via SFTP.
   */
  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    if (!this.conn) throw new Error("SSH non connecté");

    const sftp: SFTPWrapper = await new Promise((resolve, reject) => {
      this.conn!.sftp((err, client) => {
        if (err) return reject(err);
        resolve(client);
      });
    });

    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, {}, (err) => {
        sftp.end();
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * Écrit un fichier texte distant sans passer par SFTP.
   * Encode en base64 pour éviter les problèmes d'échappement.
   */
  async writeRemoteFile(remotePath: string, content: string): Promise<void> {
    const b64 = Buffer.from(content, "utf8").toString("base64");
    const dir = path.dirname(remotePath).replace(/\\/g, "/");
    const cmd =
      `mkdir -p "${dir}" && ` +
      `echo "${b64}" | base64 -d > "${remotePath}"`;

    const result = await this.exec(cmd, 30_000);
    if (result.code !== 0) {
      throw new Error(
        `Écriture distante échouée (code ${result.code}) : ${result.stderr.slice(0, 200)}`,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
  }
}