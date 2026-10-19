#!/usr/bin/env node
/**
 * scripts/ensure-redis.mjs
 *
 * Vérifie que Redis (ou Memurai sous Windows) répond, et le démarre
 * automatiquement s'il est arrêté.
 *
 * Utilisation :
 *   node scripts/ensure-redis.mjs                 -> vérifie / démarre une fois
 *   node scripts/ensure-redis.mjs --check-port    -> vérifie aussi API_PORT
 *   node scripts/ensure-redis.mjs --watch         -> surveille en continu
 *
 * Hooks npm :
 *   npm run ensure:redis   (une fois)
 *   npm run redis:watch    (surveillance continue)
 *
 * Variables lues dans <racine>/.env puis dans process.env :
 *   REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
 *   MEMURAI_EXE       chemin explicite vers memurai.exe / redis-server.exe
 *   MEMURAI_CONF      chemin explicite vers le fichier de configuration
 *   REDIS_START_CMD   commande complète de démarrage (prioritaire)
 *   REDIS_WATCH_INTERVAL  intervalle de surveillance en ms (défaut : 5000)
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WATCH = process.argv.includes("--watch");

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};

  const values = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }
  return values;
}

// dotenv ne remplace pas les variables déjà présentes : process.env gagne.
const fileEnv = readEnvFile(path.join(ROOT, ".env"));
const env = { ...fileEnv, ...process.env };

const REDIS_HOST = (env.REDIS_HOST || "localhost").trim();
const REDIS_PORT = Number(env.REDIS_PORT || 6379);
const REDIS_PASSWORD = env.REDIS_PASSWORD || "";
const WATCH_INTERVAL = Number(env.REDIS_WATCH_INTERVAL || 5000);
const CHECK_API_PORT = process.argv.includes("--check-port")
  ? Number(env.API_PORT || 4000)
  : null;

// Sur Windows, "localhost" peut résoudre en ::1 alors que Memurai n'écoute
// qu'en IPv4 : on teste donc les deux adresses.
const HOSTS = REDIS_HOST === "localhost" ? ["127.0.0.1", "::1"] : [REDIS_HOST];

function log(message) {
  console.log(`[ensure-redis] ${message}`);
}

/* ------------------------------------------------------------------ */
/* Vérification Redis (vrai PING, pas seulement le port)               */
/* ------------------------------------------------------------------ */

function resp(args) {
  return (
    `*${args.length}\r\n` +
    args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join("")
  );
}

function pingHost(host, timeout = 1200) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: REDIS_PORT });
    let buffer = "";
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeout);
    socket.on("connect", () => {
      if (REDIS_PASSWORD) socket.write(resp(["AUTH", REDIS_PASSWORD]));
      socket.write(resp(["PING"]));
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes("+PONG")) finish(true);
      else if (buffer.startsWith("-")) finish(false);
    });
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(buffer.includes("+PONG")));
  });
}

async function pingRedis(timeout) {
  for (const host of HOSTS) {
    if (await pingHost(host, timeout)) return true;
  }
  return false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForRedis(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingRedis(1000)) return true;
    await sleep(300);
  }
  return false;
}

/**
 * Vrai si quelque chose accepte les connexions sur le port donné.
 * Sert de pré-vol avant de lancer tsx (évite un EADDRINUSE en mode watch).
 */
function canConnect(host, port, timeout = 600) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeout);
    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}

async function isPortInUse(port) {
  for (const host of ["127.0.0.1", "::1"]) {
    if (await canConnect(host, port)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Démarrage de Redis / Memurai                                        */
/* ------------------------------------------------------------------ */

function isLocalHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(REDIS_HOST);
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findExecutable() {
  const candidates = [
    env.MEMURAI_EXE,
    // Outils posés à côté du dépôt (D:\ProjetL3\Outils\Redis\memurai.exe)
    path.resolve(ROOT, "../../Outils/Redis/memurai.exe"),
    path.resolve(ROOT, "../Outils/Redis/memurai.exe"),
    "C:\\Program Files\\Memurai\\memurai.exe",
    "C:\\Program Files (x86)\\Memurai\\memurai.exe",
    "C:\\Program Files\\Redis\\redis-server.exe",
    "C:\\Program Files (x86)\\Redis\\redis-server.exe",
  ];

  const lookup = process.platform === "win32" ? "where" : "which";
  for (const binary of ["memurai", "redis-server"]) {
    const result = spawnSync(lookup, [binary], { encoding: "utf8" });
    if (result.status === 0) {
      candidates.push(...result.stdout.split(/\r?\n/).filter(Boolean));
    }
  }

  return firstExisting(candidates);
}

function findConfig(executable) {
  const directory = path.dirname(executable);
  return firstExisting([
    env.MEMURAI_CONF,
    path.join(directory, "memurai.conf"),
    path.join(directory, "redis.conf"),
  ]);
}

/**
 * Démarre Redis en processus détaché.
 * @returns {string} commande lancée (pour les logs)
 */
function startRedis() {
  if (!isLocalHost()) {
    throw new Error(
      `Redis est configuré sur un hôte distant (${REDIS_HOST}) : ` +
        "le démarrage automatique local n'est pas possible.",
    );
  }

  // Commande personnalisée prioritaire (ex. Docker, service local, etc.)
  if (env.REDIS_START_CMD) {
    const child = spawn(env.REDIS_START_CMD, {
      shell: true,
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return env.REDIS_START_CMD;
  }

  const executable = findExecutable();
  if (!executable) {
    throw new Error(
      "Aucun binaire Redis/Memurai trouvé. " +
        "Définissez MEMURAI_EXE (ou REDIS_START_CMD) dans .env.",
    );
  }

  const config = findConfig(executable);
  // On se place dans le dossier de la config : Memurai y lit/écrit son dump.rdb
  // et son memurai-log.txt.
  const cwd = config ? path.dirname(config) : path.dirname(executable);
  const args = config ? [path.basename(config)] : [];

  const child = spawn(executable, args, {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  return [executable, ...args].join(" ");
}

/* ------------------------------------------------------------------ */
/* Point d'entrée                                                      */
/* ------------------------------------------------------------------ */

let busy = false;

async function ensureRedis({ quiet = false } = {}) {
  if (await pingRedis(1200)) {
    if (!quiet) log(`Redis déjà disponible sur ${REDIS_HOST}:${REDIS_PORT}.`);
    return true;
  }

  log(`Redis indisponible sur ${REDIS_HOST}:${REDIS_PORT} — démarrage automatique...`);

  let command;
  try {
    command = startRedis();
  } catch (error) {
    console.error(`[ensure-redis] ${error.message}`);
    return false;
  }

  log(`Commande lancée : ${command}`);

  if (await waitForRedis(20_000)) {
    log(`Redis est opérationnel sur ${REDIS_HOST}:${REDIS_PORT}.`);
    log("Surveillance continue possible avec : npm run redis:watch");
    return true;
  }

  console.error(
    `[ensure-redis] Redis ne répond toujours pas après 20 s.\n` +
      `  - Vérifiez que le port ${REDIS_PORT} n'est pas occupé par un autre processus.\n` +
      "  - Consultez memurai-log.txt ou définissez MEMURAI_EXE / REDIS_START_CMD dans .env.",
  );
  return false;
}

if (WATCH) {
  const initial = await ensureRedis();
  if (initial) {
    log(`Surveillance active (toutes les ${WATCH_INTERVAL} ms). Ctrl+C pour arrêter.`);
  } else {
    console.error(
      "[ensure-redis] Démarrage initial impossible ; nouvelles tentatives à chaque intervalle...",
    );
  }

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (!(await pingRedis(1200))) {
        log("Redis ne répond plus — redémarrage...");
        await ensureRedis({ quiet: true });
      }
    } finally {
      busy = false;
    }
  };

  setInterval(tick, WATCH_INTERVAL);

  const stop = () => {
    log("Surveillance arrêtée.");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else {
  const ok = await ensureRedis();
  if (!ok) process.exit(1);

  if (CHECK_API_PORT) {
    if (await isPortInUse(CHECK_API_PORT)) {
      console.error(
        `[ensure-redis] Le port ${CHECK_API_PORT} est déjà utilisé. ` +
          "Une autre instance de l'API tourne probablement : arrêtez-la (Ctrl+C) " +
          "puis relancez `npm run dev`.",
      );
      process.exit(1);
    }
    log(`Port ${CHECK_API_PORT} libre.`);
  }

  process.exit(0);
}
