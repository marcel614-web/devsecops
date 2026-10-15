import { Client } from "ssh2";
import { decryptString } from "../../secrets/crypto";

export interface DeploymentServerCreds {
  host: string;
  sshPort: number;
  username: string;
  encryptedPrivateKey: string | null;
  encryptedPassphrase: string | null;
}

export async function runRemoteCommand(
  creds: DeploymentServerCreds,
  command: string,
  timeoutMs = 2 * 60_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!creds.encryptedPrivateKey) {
    throw new Error("Clé SSH du serveur manquante");
  }

  const privateKey = decryptString(creds.encryptedPrivateKey);
  const passphrase = creds.encryptedPassphrase
    ? decryptString(creds.encryptedPassphrase)
    : undefined;

  const conn = new Client();

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error(`Timeout de connexion SSH (>15s)`));
    }, 15_000);

    conn.once("ready", () => {
      clearTimeout(timeout);
      resolve();
    });
    conn.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    try {
      conn.connect({
        host: creds.host,
        port: creds.sshPort,
        username: creds.username,
        privateKey,
        passphrase,
        readyTimeout: 15_000,
      });
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      conn.end();
      resolve({ code: 124, stdout: "", stderr: "timeout" });
    }, timeoutMs);

    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        conn.end();
        return resolve({ code: 1, stdout: "", stderr: err.message });
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
        conn.end();
        resolve({ stdout, stderr, code: code ?? 0 });
      });
    });
  });
}