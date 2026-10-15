// apps/worker/src/runners/ssh.runner.ts
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import path from "node:path";
import { logger } from "../utils/logger";

export interface SshConnectOptions {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  passphrase?: string;
  readyTimeoutMs?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class SshRunner {
  private conn: Client | null = null;

  async connect(opts: SshConnectOptions): Promise<void> {
    const config: ConnectConfig = {
      host: opts.host,
      port: opts.port,
      username: opts.username,
      privateKey: opts.privateKey,
      passphrase: opts.passphrase,
      readyTimeout: opts.readyTimeoutMs ?? 20_000,
      keepaliveInterval: 30_000,
    };

    this.conn = new Client();

    await new Promise<void>((resolve, reject) => {
      this.conn!.once("ready", () => resolve());
      this.conn!.once("error", (err) =>
        reject(new Error(`SSH ${opts.host}:${opts.port} — ${err.message}`)),
      );
      try {
        this.conn!.connect(config);
      } catch (err) {
        reject(err);
      }
    });

    logger.debug({ host: opts.host, user: opts.username }, "SSH connecté");
  }

  async exec(command: string, timeoutMs = 5 * 60_000): Promise<ExecResult> {
    if (!this.conn) throw new Error("SSH non connecté");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`Timeout SSH (${timeoutMs}ms) : ${command.slice(0, 80)}`),
        );
      }, timeoutMs);

      this.conn!.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return reject(err);
        }

        let stdout = "";
        let stderr = "";

        stream.on("data", (data: Buffer) => {
          stdout += data.toString("utf8");
        });
        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString("utf8");
        });
        stream.on("close", (code: number) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code: code ?? 0 });
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
  ): Promise<number> {
    if (!this.conn) throw new Error("SSH non connecté");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timeout SSH stream (${timeoutMs}ms) : ${command.slice(0, 80)}`,
          ),
        );
      }, timeoutMs);

      this.conn!.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return reject(err);
        }

        stream.on("data", (data: Buffer) =>
          onData(data.toString("utf8"), "stdout"),
        );
        stream.stderr.on("data", (data: Buffer) =>
          onData(data.toString("utf8"), "stderr"),
        );
        stream.on("close", (code: number) => {
          clearTimeout(timer);
          resolve(code ?? 0);
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