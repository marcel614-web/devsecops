// apps/worker/src/isolation/workspace-archive.ts
import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import type { ReadEntry } from "tar";
import {
  isSafeArchiveEntryType,
  shouldIncludePath,
} from "../utils/archive-filter";
import {
  assertSafeArtifactPath,
  assertValidPipelineId,
  isSafeTarEntryPath,
} from "./sandbox-command";
import { SANDBOX_WORKSPACES_ROOT } from "./sandbox-config";

export class SandboxArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxArchiveError";
  }
}

/**
 * Vérifie que le workspace est bien le répertoire temporaire attendu pour ce
 * pipeline, et qu'il ne s'agit pas d'un lien vers un autre emplacement.
 *
 * C'est la seule source montée dans le conteneur : elle doit être validée
 * avant tout envoi.
 */
export async function assertSafeWorkspaceDir(
  workspaceDir: string,
  pipelineId: string,
): Promise<string> {
  assertValidPipelineId(pipelineId);

  let rootReal: string;
  let workspaceReal: string;
  try {
    rootReal = await fs.realpath(SANDBOX_WORKSPACES_ROOT);
    workspaceReal = await fs.realpath(workspaceDir);
  } catch (err) {
    throw new SandboxArchiveError(
      `Workspace introuvable ou illisible (${workspaceDir}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const expected = path.resolve(rootReal, pipelineId);
  const same =
    process.platform === "win32"
      ? workspaceReal.toLowerCase() === expected.toLowerCase()
      : workspaceReal === expected;

  if (!same) {
    throw new SandboxArchiveError(
      `Workspace hors de la racine autorisée : ${workspaceReal} ` +
        `(attendu: ${expected})`,
    );
  }

  const stat = await fs.stat(workspaceReal);
  if (!stat.isDirectory()) {
    throw new SandboxArchiveError(`Le workspace n'est pas un répertoire`);
  }

  return workspaceReal;
}

export interface ArchiveResult {
  path: string;
  bytes: number;
}

function archiveEntryType(entry: Stats | ReadEntry): string | undefined {
  if (entry && typeof entry === "object" && "type" in entry) {
    return typeof entry.type === "string" ? entry.type : undefined;
  }
  // `tar.create` fournit un `fs.Stats` sur certaines plateformes.
  if (entry && typeof entry === "object" && "isFile" in entry) {
    if (entry.isFile()) return "File";
    if (entry.isDirectory()) return "Directory";
    if (entry.isSymbolicLink()) return "SymbolicLink";
    return "Other";
  }
  return undefined;
}

/**
 * Crée l'archive source envoyée à la sandbox.
 *
 * - filtre partagé avec le build Docker (secrets, `.git`, dépendances) ;
 * - refus des liens symboliques et des liens durs ;
 * - plafond de taille pour ne pas saturer le disque du moteur.
 */
export async function createWorkspaceArchive(
  workspaceDir: string,
  archivePath: string,
  maxArchiveMb: number,
  maxWorkspaceMb?: number,
): Promise<ArchiveResult> {
  await fs.mkdir(path.dirname(archivePath), { recursive: true });

  let uncompressedBytes = 0;
  await tar.create(
    {
      gzip: true,
      cwd: workspaceDir,
      file: archivePath,
      portable: true,
      follow: false,
      filter: (entryPath: string, entry: Stats | ReadEntry) => {
        if (!shouldIncludePath(entryPath)) return false;
        if (!isSafeArchiveEntryType(archiveEntryType(entry))) return false;
        if (archiveEntryType(entry) === "File" && "size" in entry) {
          uncompressedBytes += Number(entry.size) || 0;
        }
        return true;
      },
    },
    ["."],
  );

  const stat = await fs.stat(archivePath);
  const maxBytes = maxArchiveMb * 1024 * 1024;
  if (stat.size > maxBytes) {
    await fs.rm(archivePath, { force: true }).catch(() => undefined);
    throw new SandboxArchiveError(
      `Archive source trop volumineuse : ${(stat.size / 1024 / 1024).toFixed(
        1,
      )} Mo > ${maxArchiveMb} Mo`,
    );
  }
  if (
    maxWorkspaceMb !== undefined &&
    uncompressedBytes > maxWorkspaceMb * 1024 * 1024
  ) {
    await fs.rm(archivePath, { force: true }).catch(() => undefined);
    throw new SandboxArchiveError(
      `Contenu source trop volumineux avant extraction : ` +
        `${(uncompressedBytes / 1024 / 1024).toFixed(1)} Mo > ` +
        `${maxWorkspaceMb} Mo`,
    );
  }

  return { path: archivePath, bytes: stat.size };
}

/**
 * Extrait uniquement les artefacts explicitement autorisés (lockfiles,
 * freeze pip) dans le workspace local. Aucun autre chemin n'est accepté.
 *
 * L'extraction se fait dans un répertoire temporaire, puis chaque fichier est
 * recopié atomiquement dans le workspace. Cela évite qu'une entrée tar
 * remplace un lien symbolique du workspace (ex. `package-lock.json` pointant
 * vers `.env`) et écrive à travers.
 */
const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

async function assertNoSymlinkPath(
  root: string,
  relativePath: string,
): Promise<void> {
  let current = path.resolve(root);
  for (const part of relativePath.split("/").filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new SandboxArchiveError(
          `Lien symbolique refusé dans le chemin d'artefact : ${relativePath}`,
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }
}

export async function extractArtifactsArchive(
  archivePath: string,
  workspaceDir: string,
  allowedArtifacts: readonly string[],
  maxBytes = DEFAULT_MAX_ARTIFACT_BYTES,
): Promise<string[]> {
  const allowedList = allowedArtifacts.map(assertSafeArtifactPath);
  const allowed = new Set(allowedList);
  if (allowed.size === 0) return [];

  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "devsecops-artifacts-"),
  );
  const extracted: string[] = [];
  const maxTotalBytes = Math.max(1, allowed.size) * maxBytes;
  let totalBytes = 0;

  try {
    await tar.extract({
      file: archivePath,
      cwd: tempRoot,
      strict: true,
      filter: (entryPath: string, entry: Stats | ReadEntry) => {
        const normalized = entryPath.replace(/\\/g, "/").replace(/^\.\//, "");
        if (!isSafeTarEntryPath(normalized)) return false;
        if (!isSafeArchiveEntryType(archiveEntryType(entry))) return false;
        if (!allowed.has(normalized)) return false;
        const size = "size" in entry ? Number(entry.size) || 0 : 0;
        if (size > maxBytes) {
          throw new SandboxArchiveError(
            `Artefact trop volumineux : ${normalized} (${size} octets)`,
          );
        }
        totalBytes += size;
        if (totalBytes > maxTotalBytes) {
          throw new SandboxArchiveError(
            `Archive d'artefacts trop volumineuse (${totalBytes} octets)`,
          );
        }
        if (!extracted.includes(normalized)) extracted.push(normalized);
        return true;
      },
    });

    const workspaceRoot = `${path.resolve(workspaceDir)}${path.sep}`;
    for (const relative of extracted) {
      const source = path.join(tempRoot, relative);
      const stat = await fs.lstat(source);
      if (!stat.isFile()) {
        throw new SandboxArchiveError(
          `Artefact non régulier refusé : ${relative}`,
        );
      }
      if (stat.size > maxBytes) {
        throw new SandboxArchiveError(
          `Artefact trop volumineux : ${relative} (${stat.size} octets)`,
        );
      }

      const target = path.resolve(workspaceDir, relative);
      if (!target.startsWith(workspaceRoot)) {
        throw new SandboxArchiveError(`Artefact hors workspace : ${relative}`);
      }
      await assertNoSymlinkPath(workspaceDir, path.dirname(relative));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await assertNoSymlinkPath(workspaceDir, path.dirname(relative));

      const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
      await fs.copyFile(source, temporary);
      // `rm` supprime le lien lui-même, jamais sa cible.
      await fs.rm(target, { force: true });
      await fs.rename(temporary, target);
    }

    return extracted;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

export async function removeArchive(archivePath: string): Promise<void> {
  await fs.rm(archivePath, { force: true }).catch(() => undefined);
}

/** Vérifie la taille du workspace après installation. */
export async function workspaceSizeMb(dir: string): Promise<number> {
  let total = 0;
  const walk = async (current: string): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.isFile()) {
        try {
          const stat = await fs.stat(full);
          total += stat.size;
        } catch {
          // Fichier supprimé pendant le parcours : ignoré.
        }
      }
    }
  };
  await walk(dir);
  return total / 1024 / 1024;
}
