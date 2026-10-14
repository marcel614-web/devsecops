// apps/worker/src/runners/ssh.runner.ts
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
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

/**
 * Wrapper haut niveau autour de ssh2.
 * Fournit : exec, execStream, uploadFile.
 */
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

  /**
   * Exécute une commande et retourne stdout/stderr + code.
   */
  async exec(command: string, timeoutMs = 5 * 60_000): Promise<ExecResult> {
    if (!this.conn) throw new Error("SSH non connecté");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout SSH (${timeoutMs}ms) : ${command.slice(0, 80)}`));
      }, timeoutMs);

      this.conn!.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return reject(err);
        }

        let stdout = "";
        let stderr = "";
        let code = 0;

        stream.on("data", (data: Buffer) => {
          stdout += data.toString("utf8");
        });
        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString("utf8");
        });
        stream.on("close", (exitCode: number) => {
          clearTimeout(timer);
          code = exitCode ?? 0;
          resolve({ stdout, stderr, code });
        });
      });
    });
  }

  /**
   * Exécute une commande et stream les lignes en temps réel via onData.
   */
  async execStream(
    command: string,
    onData: (chunk: string, stream: "stdout" | "stderr") => void,
    timeoutMs = 10 * 60_000,
  ): Promise<number> {
    if (!this.conn) throw new Error("SSH non connecté");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout SSH stream (${timeoutMs}ms) : ${command.slice(0, 80)}`));
      }, timeoutMs);

      this.conn!.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return reject(err);
        }

        stream.on("data", (data: Buffer) => onData(data.toString("utf8"), "stdout"));
        stream.stderr.on("data", (data: Buffer) => onData(data.toString("utf8"), "stderr"));
        stream.on("close", (exitCode: number) => {
          clearTimeout(timer);
          resolve(exitCode ?? 0);
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
   * Écrit un fichier texte distant sans passer par SFTP (via heredoc).
   * Pratique pour les petits fichiers de config.
   */
  async writeRemoteFile(remotePath: string, content: string): Promise<void> {
    // On évite les injections en base64-encodant le contenu.
    const b64 = Buffer.from(content, "utf8").toString("base64");
    const cmd =
      `mkdir -p "$(dirname ${remotePath})" && ` +
      `echo ${b64} | base64 -d > ${remotePath}`;

    const result = await this.exec(cmd, 30_000);
    if (result.code !== 0) {
      throw new Error(`Ecriture distante echouee (${result.code}) : ${result.stderr}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
  }
}