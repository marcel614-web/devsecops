// apps/worker/src/steps/deployment/deploy.helper.ts
import { SshRunner } from "../../runners/ssh.runner";
import type { StepContext } from "../../orchestrator/step.executor";

// Ports exposés par l'application selon la techno.
export const APP_PORT_BY_TECH: Record<string, number> = {
  NODEJS: 3000,
  PHP: 8000,
  PYTHON: 8000,
  UNKNOWN: 80,
};

// Port de production sur la VM (évite le conflit avec Nginx système).
export const PRODUCTION_PORT = 8080;

export interface DeployComposeOptions {
  ssh: SshRunner;
  ctx: StepContext;
  remoteDir: string;
  imageTag: string;
  appPort: number;
  externalPort: number;
  environment: "STAGING" | "PRODUCTION";
  serverHost: string;
}

export interface DeployComposeResult {
  url: string;
  httpCode: string;
  healthy: boolean;
}

// ============================================================
// GÉNÉRATION DES FICHIERS DE DÉPLOIEMENT
// ============================================================

export function buildComposeFile(
  imageTag: string,
  appPort: number,
  externalPort: number,
  projectName: string,
): string {
  return `services:
  app:
    image: ${imageTag}
    restart: unless-stopped
    expose:
      - "${appPort}"
    environment:
      - NODE_ENV=production
      - PORT=${appPort}
    networks:
      - devsecops

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "${externalPort}:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - app
    networks:
      - devsecops

networks:
  devsecops:
    name: ${projectName}-devsecops
    driver: bridge
`;
}

export function buildNginxConf(appPort: number): string {
  return `server {
  listen 80;
  server_name _;

  location / {
    proxy_pass http://app:${appPort};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
}
`;
}

// ============================================================
// DÉPLOIEMENT
// ============================================================

/**
 * Arrête un éventuel déploiement hérité de l'ancienne disposition
 * (`/home/<user>/apps/<projectId>/docker-compose.yml`) pour éviter un
 * conflit de port avec la nouvelle structure par environnement.
 */
export async function stopLegacyDeployment(
  ssh: SshRunner,
  ctx: StepContext,
  projectRoot: string,
): Promise<void> {
  const result = await ssh.exec(
    `if [ -f "${projectRoot}/docker-compose.yml" ]; then ` +
      `cd "${projectRoot}" && docker compose down --remove-orphans; ` +
      `else echo "NO_LEGACY"; fi`,
    2 * 60_000,
  );
  if (!result.stdout.includes("NO_LEGACY")) {
    await ctx.log(
      "info",
      "Ancien déploiement (répertoire historique) arrêté pour libérer le port",
    );
  }
}

/**
 * Déploie une image sur un environnement donné (staging ou production)
 * et attend que l'application réponde sur le port externe.
 */
export async function deployCompose(
  opts: DeployComposeOptions,
): Promise<DeployComposeResult> {
  const {
    ssh,
    ctx,
    remoteDir,
    imageTag,
    appPort,
    externalPort,
    environment,
    serverHost,
  } = opts;

  await ctx.log(
    "info",
    `Déploiement ${environment} de ${imageTag} sur le port ${externalPort}...`,
  );

  const prep = await ssh.exec(
    `mkdir -p "${remoteDir}" && cd "${remoteDir}" && pwd`,
    30_000,
  );
  if (prep.code !== 0) {
    throw new Error(`Préparation dossier distant échouée : ${prep.stderr}`);
  }

  const projectName = (() => {
    const segments = remoteDir.split("/").filter(Boolean);
    const unique = segments.slice(-2).join("-");
    return `devsecops-${unique.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  })();

  await ssh.writeRemoteFile(
    `${remoteDir}/docker-compose.yml`,
    buildComposeFile(imageTag, appPort, externalPort, projectName),
  );
  await ssh.writeRemoteFile(`${remoteDir}/nginx.conf`, buildNginxConf(appPort));

  const upCode = await ssh.execStream(
    `cd "${remoteDir}" && docker compose -p "${projectName}" up -d --remove-orphans`,
    (chunk, stream) => {
      const line = chunk.trim();
      if (!line) return;
      for (const l of line.split("\n")) {
        if (l.trim()) {
          void ctx.log(
            stream === "stderr" ? "debug" : "info",
            `[compose:${environment}] ${l.trim()}`,
          );
        }
      }
    },
    5 * 60_000,
  );

  if (upCode !== 0) {
    throw new Error(`docker compose up a échoué (code ${upCode})`);
  }

  // Attente active : jusqu'à ~30 s pour que l'application réponde.
  const appUrl = `http://${serverHost}:${externalPort}`;
  await ctx.log("info", `Healthcheck sur ${appUrl}...`);

  let httpCode = "FAILED";
  for (let attempt = 1; attempt <= 6; attempt++) {
    await new Promise((r) => setTimeout(r, 5_000));

    const health = await ssh.exec(
      `curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "${appUrl}/" 2>/dev/null || echo "FAILED"`,
      20_000,
    );

    httpCode = health.stdout.trim();
    if (/^[1-5]\d\d$/.test(httpCode)) {
      await ctx.log("info", `Healthcheck OK (HTTP ${httpCode})`);
      return { url: appUrl, httpCode, healthy: true };
    }

    await ctx.log(
      "warn",
      `Healthcheck tentative ${attempt}/6 : ${httpCode || "aucune réponse"}`,
    );
  }

  await ctx.log("error", `Healthcheck échoué après 6 tentatives (${httpCode})`);
  return { url: appUrl, httpCode, healthy: false };
}
