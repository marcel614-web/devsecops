// apps/worker/src/steps/install-deps/node-dependencies.ts
import fs from "node:fs/promises";
import path from "node:path";
import type { SandboxSession } from "../../isolation/sandbox";
import type { SandboxRunResult } from "../../isolation/sandbox";
import { SandboxCommandError } from "../../isolation/sandbox-errors";
import type { SandboxLogger } from "../../isolation/sandbox";

/**
 * Arguments npm communs à l'installation initiale et à la réinstallation
 * éventuelle dans une sandbox recréée (reprise de pipeline).
 *
 * `--ignore-scripts` est conservé : les scripts postinstall du dépôt ne sont
 * pas exécutés, même dans la sandbox. Cela réduit la surface d'attaque et le
 * comportement reste celui d'avant l'introduction de la sandbox.
 */
export function nodeInstallArgs(hasLockfile: boolean): string[] {
  const common = [
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    "--no-engine-strict",
    "--prefer-offline",
  ];
  return hasLockfile
    ? ["ci", ...common]
    : ["install", ...common, "--legacy-peer-deps"];
}

export async function hasLockfile(workspaceDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(workspaceDir, "package-lock.json"));
    return true;
  } catch {
    return false;
  }
}

export async function runNodeInstall(
  session: SandboxSession,
  workspaceDir: string,
  timeoutMs: number,
): Promise<SandboxRunResult> {
  const lockfile = await hasLockfile(workspaceDir);
  return session.run({
    command: "npm",
    args: nodeInstallArgs(lockfile),
    timeoutMs,
    network: "egress",
    label: lockfile ? "npm ci" : "npm install",
  });
}

/**
 * Garantit la présence de node_modules dans la sandbox.
 *
 * Cas normal : INSTALL_DEPS vient de s'exécuter et la session est réutilisée.
 * Cas reprise : la sandbox a été détruite (fin de pipeline précédent ou
 * redémarrage du worker) ; on recrée les dépendances avant les tests, sans
 * jamais retomber sur l'hôte.
 */
export async function ensureNodeModules(
  session: SandboxSession,
  workspaceDir: string,
  timeoutMs: number,
  log: SandboxLogger,
): Promise<void> {
  if (await session.pathExists("node_modules")) return;

  await log(
    "warn",
    "Sandbox recréée : node_modules absent, réinstallation des dépendances " +
      "avant les tests",
  );
  const result = await runNodeInstall(session, workspaceDir, timeoutMs);
  if (result.exitCode !== 0) {
    throw new SandboxCommandError("npm install (sandbox recréée)", result);
  }
}
