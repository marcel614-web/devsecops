// apps/worker/src/no-shell.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC_DIR = path.join(__dirname);

/**
 * Garde-fou structurel : aucune etape du worker ne doit interpreter le
 * shell.
 *
 * `shell: true` transformait les arguments en ligne de commande transmise a
 * `cmd.exe` / `/bin/sh`. L'URL cible du DAST (derivee de l'hote du serveur
 * de deploiement, saisi par l'utilisateur) ou un chemin de workspace
 * pouvaient alors injecter une commande arbitraire.
 */
function collectOffenders(pattern: RegExp): string[] {
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "test" || entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
        continue;
      }

      const content = fs.readFileSync(full, "utf8");
      // On ignore les commentaires : seuls le code compte.
      const code = content
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      if (pattern.test(code)) {
        offenders.push(path.relative(SRC_DIR, full));
      }
    }
  };

  walk(SRC_DIR);
  return offenders;
}

describe("SÃ©curitÃ© â€” aucun shell dans le worker", () => {
  it("aucune Ã©tape n'utilise `shell: true`", () => {
    expect(collectOffenders(/shell\s*:\s*true/)).toEqual([]);
  });

  it("aucune Ã©tape n'importe execFile directement de node:child_process", () => {
    // Seul `step.executor.ts` (utilitaire interne) ou le runner SSH
    // peuvent le faire ; les Ã©tapes de scan ne doivent pas.
    const offenders = collectOffenders(
      /import\s*\{[^}]*\bexecFile\b[^}]*\}\s*from\s*"node:child_process"/,
    ).filter((file) => !file.includes("step.executor.ts"));
    expect(offenders).toEqual([]);
  });
});
