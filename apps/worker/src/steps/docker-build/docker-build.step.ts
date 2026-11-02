// apps/worker/src/steps/docker-build/docker-build.step.ts
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import * as tar from "tar";
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import { logger } from "../../utils/logger";
import { SshRunner } from "../../runners/ssh.runner";
import { isFullGitSha, isTransientNetworkError } from "@devsecops/shared";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import { shouldIncludePath } from "../../utils/archive-filter";

// Ré-exporté pour les tests historiques et les appelants qui importaient le
// filtre depuis cette étape. L'implémentation vit désormais dans
// `utils/archive-filter.ts`, partagée avec la sandbox.
export { shouldIncludePath };

// ============================================================
// OPTIONS DE BUILD RÉSEAU
// ============================================================
/**
 * Certaines VM de build ont un démon Docker dont le résolveur
 * (`/etc/resolv.conf` → `127.0.0.53` via systemd-resolved) n'est pas
 * joignable depuis le réseau de build : `docker build` échoue alors sur
 * `lookup registry-1.docker.io ... i/o timeout`, et `pip`/`npm` dans les
 * couches `RUN` échouent de la même façon.
 *
 * `DOCKER_BUILD_NETWORK=host` fait utiliser le réseau de l'hôte aux
 * conteneurs de build, où la résolution DNS fonctionne. Vide = comportement
 * Docker par défaut. La valeur est validée (allow-list) car elle est
 * insérée dans une commande shell distante.
 */
const DOCKER_BUILD_NETWORK = (process.env.DOCKER_BUILD_NETWORK ?? "").trim();
const ALLOWED_BUILD_NETWORKS = new Set(["host", "bridge", "none", "default"]);
const DEFAULT_DOCKER_BUILD_ATTEMPTS = 2;

function dockerBuildAttempts(): number {
  const parsed = Number.parseInt(
    process.env.DOCKER_BUILD_ATTEMPTS ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DOCKER_BUILD_ATTEMPTS;
}

function dockerBuildDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Délai maximal d'un build (par défaut 20 min). Sur un réseau lent, le
 * premier build Python peut télécharger plusieurs dizaines de Mo de
 * wheels ; le cache BuildKit rend les suivants beaucoup plus rapides.
 */
function dockerBuildTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.DOCKER_BUILD_TIMEOUT_MS ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20 * 60_000;
}


// ============================================================
// GÉNÉRATION DU DOCKERFILE PAR DÉFAUT
// ============================================================
async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

interface PythonStartCommand {
  command: string[];
  extraInstall?: string;
}

/**
 * Détermine comment démarrer une application Python.
 *
 * Le fallback historique (`python -m http.server`) sert les fichiers
 * sources et ne lance pas l'application (Flask, FastAPI, Django…).
 * On détecte donc le framework et le fichier d'entrée pour démarrer
 * réellement l'application sur le port 8000 exposé par le conteneur.
 */
async function detectPythonStart(
  workspaceDir: string,
): Promise<PythonStartCommand> {
  const requirements =
    (await readTextIfExists(path.join(workspaceDir, "requirements.txt"))) ?? "";
  const pyproject =
    (await readTextIfExists(path.join(workspaceDir, "pyproject.toml"))) ?? "";
  const dependencies = `${requirements}\n${pyproject}`.toLowerCase();

  // Django
  if (await fileExists(path.join(workspaceDir, "manage.py"))) {
    return {
      command: ["python", "manage.py", "runserver", "0.0.0.0:8000"],
    };
  }

  const candidates = ["web_server", "app", "main", "server", "wsgi"];

  for (const moduleName of candidates) {
    const source = await readTextIfExists(
      path.join(workspaceDir, `${moduleName}.py`),
    );
    if (!source) continue;

    // FastAPI : app = FastAPI()
    const fastapiMatch = source.match(
      /^\s*([A-Za-z_]\w*)\s*=\s*FastAPI\s*\(/m,
    );
    if (fastapiMatch) {
      const extraInstall = dependencies.includes("uvicorn")
        ? undefined
        : "RUN --mount=type=cache,target=/root/.cache/pip pip install uvicorn";
      return {
        command: [
          "python",
          "-m",
          "uvicorn",
          `${moduleName}:${fastapiMatch[1]}`,
          "--host",
          "0.0.0.0",
          "--port",
          "8000",
        ],
        extraInstall,
      };
    }

    // Flask : app = Flask(__name__)
    const flaskMatch = source.match(/^\s*([A-Za-z_]\w*)\s*=\s*Flask\s*\(/m);
    if (flaskMatch) {
      const appVariable = flaskMatch[1];
      const appSpec =
        appVariable === "app" ? moduleName : `${moduleName}:${appVariable}`;
      return {
        command: [
          "flask",
          "--app",
          appSpec,
          "run",
          "--host",
          "0.0.0.0",
          "--port",
          "8000",
        ],
      };
    }

    // Flask sans assignation détectable mais avec app.run(...)
    if (/app\.run\s*\(/.test(source) && dependencies.includes("flask")) {
      return {
        command: [
          "flask",
          "--app",
          moduleName,
          "run",
          "--host",
          "0.0.0.0",
          "--port",
          "8000",
        ],
      };
    }
  }

  // Script Python classique avec un point d'entrée explicite.
  for (const moduleName of ["main", "app", "server", "web_server"]) {
    const source = await readTextIfExists(
      path.join(workspaceDir, `${moduleName}.py`),
    );
    if (
      source &&
      /if\s+__name__\s*==\s*["']__main__["']/.test(source)
    ) {
      return { command: ["python", `${moduleName}.py`] };
    }
  }

  // Dernier recours : serveur de fichiers statiques.
  return { command: ["python", "-m", "http.server", "8000"] };
}

async function generateDockerfile(
  tech: string,
  workspaceDir: string,
): Promise<string> {
  if (tech === "NODEJS") {
    return [
      "FROM node:24-alpine",
      "WORKDIR /app",
      "COPY package*.json ./",
      "RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund",
      "COPY . .",
      "RUN rm -f .devsecops.Dockerfile",
      "EXPOSE 3000",
      'CMD ["node", "index.js"]',
    ].join("\n");
  }
  if (tech === "PHP") {
    return [
      "FROM php:8.3-cli",
      "WORKDIR /app",
      "COPY . .",
      "RUN rm -f .devsecops.Dockerfile",
      "EXPOSE 8000",
      'CMD ["php", "-S", "0.0.0.0:8000"]',
    ].join("\n");
  }
  if (tech === "PYTHON") {
    const start = await detectPythonStart(workspaceDir);
    const lines = [
      "FROM python:3.12-slim",
      "WORKDIR /app",
      "ENV PYTHONUNBUFFERED=1",
      "COPY requirements.txt* pyproject.toml* ./",
      // Cache pip persistant entre builds BuildKit : sans lui, chaque
      // build retélécharge toutes les wheels (réseau de la VM lent) et
      // peut dépasser le délai de build.
      "RUN --mount=type=cache,target=/root/.cache/pip sh -c \"(test -f requirements.txt && pip install --retries 10 --timeout 120 -r requirements.txt) || (test -f pyproject.toml && pip install --retries 10 --timeout 120 .) || true\"",
    ];
    if (start.extraInstall) lines.push(start.extraInstall);
    lines.push(
      "COPY . .",
      "RUN rm -f .devsecops.Dockerfile",
      "EXPOSE 8000",
      `CMD ${JSON.stringify(start.command)}`,
    );
    return lines.join("\n");
  }
  return [
    "FROM alpine:latest",
    "WORKDIR /app",
    "COPY . .",
    "RUN rm -f .devsecops.Dockerfile",
    'CMD ["sleep", "3600"]',
  ].join("\n");
}

async function detectTech(workspaceDir: string): Promise<string> {
  if (await fileExists(path.join(workspaceDir, "package.json"))) return "NODEJS";
  if (await fileExists(path.join(workspaceDir, "composer.json"))) return "PHP";
  if (await fileExists(path.join(workspaceDir, "requirements.txt"))) return "PYTHON";
  if (await fileExists(path.join(workspaceDir, "pyproject.toml"))) return "PYTHON";
  return "UNKNOWN";
}

// ============================================================
// ÉTAPE BUILD
// ============================================================
export async function dockerBuildStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  // ----------------------------------------------------------
  // 0. Garde-fou : le SHA alimente le tag Docker, qui part ensuite dans
  //    une commande shell exécutée sur la VM de déploiement.
  //    On le valide ici (défense en profondeur : l'API le valide aussi,
  //    mais le worker ne doit jamais faire confiance à la base).
  // ----------------------------------------------------------
  if (!isFullGitSha(ctx.commitSha)) {
    return {
      success: false,
      exitCode: 1,
      error: `SHA de commit invalide : "${ctx.commitSha}". Refus de construire l'image.`,
    };
  }

  // Le tag doit être unique par build : deux runs ne doivent jamais pointer
  // vers la même image, sinon le second écrase le tag du premier et le
  // rollback redéploie la mauvaise version.
  //
  // - SHA de commit réel tronqué à 12 caractères : 48 bits d'entropie,
  //   le risque de collision est négligeable.
  // - SHA de substitution (`manual-<epoch ms>`) : tronqué à 12 caractères il
  //   ne reste que 5 chiffres significatifs, ce qui produit des collisions
  //   régulières entre deux runs lancés à la même seconde. On utilise
  //   l'identifiant du pipeline, qui est unique par construction.
  //
  // Le suffixe pipeline garantit qu'une nouvelle exécution du même commit
  // ne réutilise pas le tag d'un build antérieur : chaque artefact reste
  // identifiable par son digest.
  const tagSuffix = ctx.commitSha.startsWith("manual-")
    ? ctx.pipelineId
    : `${ctx.commitSha.slice(0, 12)}-${ctx.pipelineId}`;

  const imageTag = `devsecops/${ctx.projectId}:${tagSuffix}`;

  // ----------------------------------------------------------
  // 1. Charge le projet + serveur
  // ----------------------------------------------------------
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { server: true },
  });

  if (!project) {
    return { success: false, exitCode: 1, error: "Projet introuvable" };
  }

  if (!project.server) {
    return {
      success: false,
      exitCode: 1,
      error:
        "Aucun serveur de déploiement associé au projet — impossible de construire l'image (Docker est sur la VM).",
    };
  }

  const server = project.server;

  if (!server.encryptedPrivateKey) {
    return {
      success: false,
      exitCode: 1,
      error: "Clé SSH du serveur manquante",
    };
  }

  // ----------------------------------------------------------
  // 2. Prépare le Dockerfile
  // ----------------------------------------------------------
  let dockerfileArg = "Dockerfile";
  let generated = false;

  const dockerfilePath = path.join(ctx.workspaceDir, "Dockerfile");
  if (!(await fileExists(dockerfilePath))) {
    await ctx.log("warn", "Aucun Dockerfile fourni — génération automatique");
    const tech = await detectTech(ctx.workspaceDir);
    await ctx.log("info", `Technologie détectée pour le Dockerfile : ${tech}`);

    const content = await generateDockerfile(tech, ctx.workspaceDir);
    await fs.writeFile(
      path.join(ctx.workspaceDir, ".devsecops.Dockerfile"),
      content,
      "utf8",
    );
    dockerfileArg = ".devsecops.Dockerfile";
    generated = true;
  } else {
    await ctx.log("info", "Dockerfile trouvé dans le repository");
  }

  // ----------------------------------------------------------
  // 3. Crée l'archive tar.gz du workspace (avec exclusions)
  // ----------------------------------------------------------
  const archivePath = path.join(
    os.tmpdir(),
    `devsecops-build-${ctx.pipelineId}.tar.gz`,
  );

  await ctx.log(
    "info",
    "Préparation de l'archive source (exclusion de node_modules, .git, dist, etc.)...",
  );

  try {
    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: ctx.workspaceDir,
        portable: true,
        filter: (entryPath: string) => shouldIncludePath(entryPath),
      },
      ["."],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Échec de création de l'archive : ${msg}`);
    return { success: false, exitCode: 1, error: msg };
  }

  const stat = await fs.stat(archivePath);
  const sizeMb = (stat.size / 1024 / 1024).toFixed(2);
  await ctx.log("info", `Archive créée (${sizeMb} MB)`);

  // ----------------------------------------------------------
  // 4. Connexion SSH
  // ----------------------------------------------------------
  const ssh = new SshRunner();

  let privateKey: string;
  try {
    privateKey = decryptString(server.encryptedPrivateKey);
  } catch {
    await fs.rm(archivePath, { force: true }).catch(() => undefined);
    return {
      success: false,
      exitCode: 1,
      error: "Impossible de déchiffrer la clé SSH du serveur",
    };
  }

  const passphrase = server.encryptedPassphrase
    ? decryptString(server.encryptedPassphrase)
    : undefined;

  const remoteDir = `/home/${server.username}/apps/${ctx.projectId}/build-${ctx.pipelineId}`;
  const remoteArchive = `${remoteDir}/source.tar.gz`;

  try {
    await ctx.log("info", "Connexion SSH à la VM de build...");
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
      hostKeyFingerprint: server.hostKeyFingerprint,
    });

    // ------------------------------------------------------
    // 5. Prépare le répertoire distant
    // ------------------------------------------------------
    const prep = await ssh.exec(
      `mkdir -p "${remoteDir}" && cd "${remoteDir}" && pwd`,
      30_000,
    );
    if (prep.code !== 0) {
      throw new Error(
        `Préparation du dossier distant échouée : ${prep.stderr}`,
      );
    }

    // ------------------------------------------------------
    // 6. Upload de l'archive
    // ------------------------------------------------------
    await ctx.log("info", "Envoi de l'archive source vers la VM...");
    await ssh.uploadFile(archivePath, remoteArchive);

    // ------------------------------------------------------
    // 7. Extraction
    // ------------------------------------------------------
    await ctx.log("info", "Extraction de l'archive sur la VM...");
    const extractCode = await ssh.execStream(
      `cd "${remoteDir}" && tar -xzf source.tar.gz && rm -f source.tar.gz && ls -la | head -10`,
      (chunk, stream) => {
        if (stream === "stderr") {
          const line = chunk.trim();
          if (line) void ctx.log("debug", `[tar] ${line}`);
        }
      },
      2 * 60_000,
    );
    if (extractCode !== 0) {
      throw new Error(`Extraction tar échouée (code ${extractCode})`);
    }

    // ------------------------------------------------------
    // 8. Build sur la VM
    // ------------------------------------------------------
    let networkArg = "";
    if (DOCKER_BUILD_NETWORK) {
      if (ALLOWED_BUILD_NETWORKS.has(DOCKER_BUILD_NETWORK)) {
        networkArg = ` --network ${DOCKER_BUILD_NETWORK}`;
        await ctx.log(
          "info",
          `Réseau de build Docker : ${DOCKER_BUILD_NETWORK} (DOCKER_BUILD_NETWORK)`,
        );
      } else {
        await ctx.log(
          "warn",
          `DOCKER_BUILD_NETWORK invalide (${DOCKER_BUILD_NETWORK}) — ignoré`,
        );
      }
    }

    await ctx.log("info", `Build de l'image ${imageTag} sur la VM...`);
    const buildStart = Date.now();
    const buildCommand =
      `cd "${remoteDir}" && DOCKER_BUILDKIT=1 docker build` +
      `${networkArg} -f "${dockerfileArg}" -t "${imageTag}"` +
      ` --label devsecops.pipeline=${ctx.pipelineId}` +
      ` --label devsecops.project=${ctx.projectId} .`;

    const buildAttempts = dockerBuildAttempts();
    let buildCode = -1;
    let buildOutput = "";

    for (let attempt = 1; attempt <= buildAttempts; attempt += 1) {
      if (attempt > 1) {
        await ctx.log(
          "warn",
          `Nouvelle tentative de build (${attempt}/${buildAttempts})...`,
        );
      }

      buildOutput = "";
      buildCode = await ssh.execStream(
        buildCommand,
        (chunk, stream) => {
          buildOutput += chunk;
          // On ne conserve que la fin : suffisant pour détecter une erreur
          // réseau et pour le diagnostic.
          if (buildOutput.length > 20_000) {
            buildOutput = buildOutput.slice(-20_000);
          }
          const trimmed = chunk.trim();
          if (!trimmed) return;
          for (const line of trimmed.split("\n")) {
            if (!line.trim()) continue;
            void ctx.log(
              stream === "stderr" ? "debug" : "info",
              `[build] ${line}`,
            );
          }
        },
        dockerBuildTimeoutMs(),
      );

      if (buildCode === 0) break;

      const transient = isTransientNetworkError({ message: buildOutput });
      if (!transient || attempt >= buildAttempts) break;

      await ctx.log(
        "warn",
        "Échec réseau transitoire pendant le build (DNS/timeout) — " +
          "nouvelle tentative dans quelques secondes",
      );
      await dockerBuildDelay(5000 * attempt);
    }

    if (buildCode !== 0) {
      throw new Error(`docker build a échoué (code ${buildCode})`);
    }

    const buildDuration = Date.now() - buildStart;
    await ctx.log(
      "info",
      `Build réussi en ${(buildDuration / 1000).toFixed(1)}s`,
    );

    // ------------------------------------------------------
    // 9. Récupère l'ID, le digest et la taille de l'image
    // ------------------------------------------------------
    let imageId: string | null = null;
    let imageDigest: string | null = null;
    let sizeBytes: bigint | null = null;

    try {
      const idResult = await ssh.exec(
        `docker inspect --format '{{.Id}}' "${imageTag}"`,
        30_000,
      );
      if (idResult.code === 0) imageId = idResult.stdout.trim();

      // `.Id` est le digest immuable de l'image locale. Il sert de référence
      // de promotion : le tag seul ne prouve jamais l'identité de l'artefact.
      if (imageId && /^sha256:[a-f0-9]{64}$/u.test(imageId)) {
        imageDigest = imageId;
      }

      const sizeResult = await ssh.exec(
        `docker inspect --format '{{.Size}}' "${imageTag}"`,
        30_000,
      );
      if (sizeResult.code === 0) {
        const parsed = Number.parseInt(sizeResult.stdout.trim(), 10);
        if (!Number.isNaN(parsed)) sizeBytes = BigInt(parsed);
      }
    } catch {
      await ctx.log("warn", "Impossible d'inspecter l'image");
    }

    if (!imageDigest) {
      throw new Error(
        `Digest de l'image ${imageTag} introuvable après le build — ` +
          "l'artefact ne peut pas être tracé jusqu'en production.",
      );
    }

    await ctx.log(
      "info",
      `Image : ${imageTag} — digest ${imageDigest}${
        sizeBytes ? ` (${(Number(sizeBytes) / 1024 / 1024).toFixed(1)} MB)` : ""
      }`,
    );

    // ------------------------------------------------------
    // 10. Persiste dans DockerImage
    // ------------------------------------------------------
    await prisma.dockerImage.upsert({
      where: { pipelineId: ctx.pipelineId },
      create: {
        pipelineId: ctx.pipelineId,
        imageTag,
        imageId,
        imageDigest,
        digestAlgorithm: "sha256",
        digestVerifiedAt: new Date(),
        sizeBytes,
        registry: "vm-local",
      },
      update: {
        imageTag,
        imageId,
        imageDigest,
        digestAlgorithm: "sha256",
        digestVerifiedAt: new Date(),
        sizeBytes,
        registry: "vm-local",
      },
    });

    return {
      success: true,
      exitCode: 0,
      data: {
        imageTag,
        imageId,
        imageDigest,
        sizeBytes: sizeBytes ? Number(sizeBytes) : null,
        buildDurationMs: buildDuration,
        builtOnVm: true,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Échec du build Docker : ${msg}`);
    return { success: false, exitCode: 1, error: msg };
  } finally {
    // Nettoyage local
    await fs.rm(archivePath, { force: true }).catch(() => undefined);

    // Nettoyage du Dockerfile généré
    if (generated) {
      await fs
        .rm(path.join(ctx.workspaceDir, ".devsecops.Dockerfile"), {
          force: true,
        })
        .catch(() => undefined);
    }

    // Nettoyage distant (dossier de build)
    await ssh
      .exec(`rm -rf "${remoteDir}"`, 30_000)
      .catch(() => undefined);

    await ssh.disconnect().catch(() => undefined);
  }
}