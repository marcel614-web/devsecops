// packages/scanners/src/no-shell.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SCANNERS_DIR = path.join(__dirname, "scanners");

/**
 * Garde-fou structurel : plus aucun scanner ne doit interpreter le shell.
 *
 * `execFile(..., { shell: true })` concatene les arguments en une ligne de
 * commande transmise a `cmd.exe` / `/bin/sh`, qui en interprete les
 * metacaracteres. Un chemin ou une URL contenant `; whoami` executait alors
 * une commande arbitraire sur la machine du worker.
 */
describe("SÃ©curitÃ© â€” aucun shell dans les scanners", () => {
  const scannerFiles = fs
    .readdirSync(SCANNERS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("la suite contient bien des scanners", () => {
    expect(scannerFiles.length).toBeGreaterThan(0);
  });

  it("aucun scanner n'utilise `shell: true`", () => {
    const offenders: string[] = [];

    for (const file of scannerFiles) {
      const content = fs.readFileSync(path.join(SCANNERS_DIR, file), "utf8");
      // On ignore les commentaires : seuls le code compte.
      const code = content
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      if (/shell\s*:\s*true/.test(code)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("aucun scanner n'importe directement execFile de node:child_process", () => {
    const offenders: string[] = [];

    for (const file of scannerFiles) {
      const content = fs.readFileSync(path.join(SCANNERS_DIR, file), "utf8");
      const code = content
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      if (/from\s+"node:child_process"/.test(code)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
