// apps/worker/src/steps/iac/ansible-detection.ts
import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

export interface AnsibleDetection {
  detected: boolean;
  /** Chemins absolus des playbooks, triés et bornés. */
  playbooks: string[];
  roleDirs: string[];
  inventoryFiles: string[];
  evidence: string[];
  truncated: boolean;
}

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".terraform",
]);

const MAX_DEPTH = 6;
const MAX_FILES_INSPECTED = 800;
const MAX_PLAYBOOKS = 100;
const MAX_YAML_BYTES = 512 * 1024;

function isYaml(filename: string): boolean {
  return /\.(ya?ml)$/iu.test(filename);
}

function isPlaybook(content: string): boolean {
  const hosts =
    /^\s*-\s+hosts\s*:\s*\S+/mu.test(content) ||
    /^\s*-\s+name\s*:[^\n]*\r?\n\s+hosts\s*:\s*\S+/mu.test(content) ||
    /^\s*-\s+import_playbook\s*:/mu.test(content);
  if (!hosts) return false;
  return (
    /^\s*(tasks|roles|pre_tasks|post_tasks|handlers|import_playbook)\s*:/mu.test(
      content,
    ) || /^\s*-\s+import_playbook\s*:/mu.test(content)
  );
}

/**
 * Détection déterministe des projets Ansible.
 *
 * On ne se contente pas de l'extension YAML : un fichier de variables ou un
 * manifeste Kubernetes ne doit pas déclencher ansible-lint. Les playbooks
 * sont reconnus à leur structure (`hosts` + tâches/rôles/imports), et les
 * rôles par leur arborescence `roles/<nom>/tasks/main.yml`.
 */
export async function detectAnsibleProject(
  workspaceDir: string,
): Promise<AnsibleDetection> {
  const playbooks: string[] = [];
  const roleDirs = new Set<string>();
  const inventoryFiles = new Set<string>();
  const evidence = new Set<string>();
  let truncated = false;
  let inspected = 0;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || inspected >= MAX_FILES_INSPECTED) {
      if (inspected >= MAX_FILES_INSPECTED) truncated = true;
      return;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (inspected >= MAX_FILES_INSPECTED) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;

      const absolute = path.join(dir, entry.name);
      const relative = path.relative(workspaceDir, absolute) || entry.name;

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name === "roles") {
          try {
            const roles = await fs.readdir(absolute, { withFileTypes: true });
            for (const role of roles) {
              if (role.isDirectory()) {
                roleDirs.add(path.join(absolute, role.name));
                evidence.add(`${relative}/${role.name}/`);
              }
            }
          } catch {
            // Arborescence illisible : on continue la détection.
          }
        }
        if (entry.name === "inventory" || entry.name === "inventories") {
          evidence.add(relative);
        }
        await walk(absolute, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      inspected++;

      if (
        entry.name === "ansible.cfg" ||
        entry.name === "requirements.yml" ||
        entry.name === "requirements.yaml" ||
        entry.name === "galaxy.yml"
      ) {
        evidence.add(relative);
        continue;
      }

      if (/^(inventory|hosts)(\.[^/\\]+)?$/iu.test(entry.name)) {
        inventoryFiles.add(absolute);
        evidence.add(relative);
        continue;
      }

      if (!isYaml(entry.name)) continue;

      // Un rôle est identifié par son arborescence, sans lire chaque tâche.
      if (/[/\\]roles[/\\][^/\\]+[/\\](tasks|handlers|defaults|vars)[/\\]/u.test(absolute)) {
        evidence.add(relative);
        continue;
      }

      let content: string;
      try {
        const stat = await fs.stat(absolute);
        if (stat.size > MAX_YAML_BYTES) continue;
        content = await fs.readFile(absolute, "utf8");
      } catch {
        continue;
      }

      if (isPlaybook(content)) {
        if (playbooks.length >= MAX_PLAYBOOKS) {
          truncated = true;
          continue;
        }
        playbooks.push(absolute);
        evidence.add(relative);
      }
    }
  };

  await walk(workspaceDir, 0);

  playbooks.sort((a, b) => a.localeCompare(b));

  return {
    detected: playbooks.length > 0 || roleDirs.size > 0 || evidence.size > 0,
    playbooks,
    roleDirs: [...roleDirs].sort(),
    inventoryFiles: [...inventoryFiles].sort(),
    evidence: [...evidence].sort(),
    truncated,
  };
}
