// apps/api/src/modules/servers/ssh-tester.service.ts
import { Client } from "ssh2";
import { decryptString } from "../../secrets/crypto";
import { logger } from "../../utils/logger";

export interface ServerTestResult {
  ssh: {
    ok: boolean;
    error?: string;
    latencyMs?: number;
  };
  docker: {
    ok: boolean;
    version?: string;
    error?: string;
  };
  dockerCompose: {
    ok: boolean;
    version?: string;
    error?: string;
  };
  nginx: {
    ok: boolean;
    version?: string;
    error?: string;
  };
}

interface ServerCreds {
  host: string;
  sshPort: number;
  username: string;
  encryptedPrivateKey: string | null;
  encryptedPassphrase: string | null;
}

// ============================================================
// EXÉCUTION DISTANTE
// ============================================================

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

function sshExec(conn: Client, cmd: string, timeoutMs = 15_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ stdout: "", stderr: "timeout", code: 124 });
    }, timeoutMs);

    conn.exec(cmd, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        return resolve({ stdout: "", stderr: err.message, code: 1 });
      }

      let stdout = "";
      let stderr = "";

      stream.on("data", (data: Buffer) => (stdout += data.toString("utf8")));
      stream.stderr.on("data", (data: Buffer) => (stderr += data.toString("utf8")));
      stream.on("close", (code: number) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? 0 });
      });
    });
  });
}

// ============================================================
// TEST PRINCIPAL
// ============================================================

export async function testServerConnection(
  server: ServerCreds,
): Promise<ServerTestResult> {
  const result: ServerTestResult = {
    ssh: { ok: false },
    docker: { ok: false },
    dockerCompose: { ok: false },
    nginx: { ok: false },
  };

  if (!server.encryptedPrivateKey) {
    result.ssh.error = "Aucune clé privée enregistrée pour ce serveur";
    return result;
  }

  let privateKey: string;
  try {
    privateKey = decryptString(server.encryptedPrivateKey);
  } catch {
    result.ssh.error = "Impossible de déchiffrer la clé privée SSH";
    return result;
  }

  const passphrase = server.encryptedPassphrase
    ? decryptString(server.encryptedPassphrase)
    : undefined;

  const conn = new Client();
  const startTime = Date.now();

  // ----------------------------------------------------------
  // ÉTAPE 1 : Connexion SSH
  // ----------------------------------------------------------
  const sshConnect = new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: "Timeout de connexion SSH (>15s)" });
      conn.end();
    }, 15_000);

    conn.once("ready", () => {
      clearTimeout(timeout);
      resolve({ ok: true });
    });

    conn.once("error", (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: sanitizeSshError(err.message) });
    });

    try {
      conn.connect({
        host: server.host,
        port: server.sshPort,
        username: server.username,
        privateKey,
        passphrase,
        readyTimeout: 15_000,
      });
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      resolve({ ok: false, error: sanitizeSshError(msg) });
    }
  });

  const sshResult = await sshConnect;
  const latencyMs = Date.now() - startTime;

  if (!sshResult.ok) {
    result.ssh = { ok: false, error: sshResult.error, latencyMs };
    return result;
  }

  result.ssh = { ok: true, latencyMs };

  // ----------------------------------------------------------
  // ÉTAPE 2 : Vérification des outils
  // ----------------------------------------------------------
  try {
    // Docker
    const dockerCheck = await sshExec(conn, "docker --version 2>&1 || echo __NOT_FOUND__");
    if (dockerCheck.stdout.includes("__NOT_FOUND__") || dockerCheck.code !== 0) {
      result.docker = { ok: false, error: "Docker non installé ou non accessible" };
    } else {
      const version = dockerCheck.stdout.match(/Docker version ([^\s,]+)/)?.[1] ?? "unknown";
      result.docker = { ok: true, version };
    }

    // Docker Compose (v2 = plugin, v1 = standalone)
    const composeCheck = await sshExec(
      conn,
      "docker compose version 2>/dev/null || docker-compose --version 2>/dev/null || echo __NOT_FOUND__",
    );
    if (composeCheck.stdout.includes("__NOT_FOUND__") || composeCheck.code !== 0) {
      result.dockerCompose = {
        ok: false,
        error: "Docker Compose non installé",
      };
    } else {
      const version = composeCheck.stdout.match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? "unknown";
      result.dockerCompose = { ok: true, version };
    }

    // Nginx
    const nginxCheck = await sshExec(
      conn,
      "nginx -v 2>&1 || echo __NOT_FOUND__",
    );
    // nginx -v écrit sur stderr, donc on regarde les deux
    const nginxOutput = `${nginxCheck.stdout} ${nginxCheck.stderr}`.trim();
    if (nginxOutput.includes("__NOT_FOUND__")) {
      result.nginx = { ok: false, error: "Nginx non installé" };
    } else {
      const version = nginxOutput.match(/nginx\/([\d.]+)/)?.[1] ?? "unknown";
      result.nginx = { ok: true, version };
    }

    // Vérifie que l'utilisateur peut piloter Docker sans sudo
    const dockerPermCheck = await sshExec(conn, "docker ps >/dev/null 2>&1 && echo OK || echo DENIED");
    if (dockerPermCheck.stdout.includes("DENIED")) {
      result.docker.ok = false;
      result.docker.error =
        "L'utilisateur n'a pas la permission d'utiliser Docker (ajoutez-le au groupe 'docker')";
    }
  } catch (err) {
    logger.warn({ err }, "Erreur pendant les vérifications du serveur");
  } finally {
    conn.end();
  }

  return result;
}

// ============================================================
// NETTOYAGE DES MESSAGES D'ERREUR SSH
// ============================================================

function sanitizeSshError(msg: string): string {
  // Ne jamais renvoyer de détails sur la clé privée
  if (msg.includes("Cannot parse privateKey")) {
    return "Clé privée SSH invalide ou corrompue";
  }
  if (msg.includes("Authentication failed") || msg.includes("All configured authentication methods failed")) {
    return "Authentification refusée — vérifiez la clé publique sur le serveur";
  }
  if (msg.includes("ECONNREFUSED")) {
    return "Connexion refusée — le serveur SSH n'écoute pas sur ce port";
  }
  if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) {
    return "Délai d'attente dépassé — vérifiez l'adresse et le pare-feu";
  }
  if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
    return "Hôte introuvable — vérifiez l'adresse IP ou le hostname";
  }
  if (msg.includes("EHOSTUNREACH")) {
    return "Hôte injoignable — vérifiez le réseau";
  }
  return msg;
}