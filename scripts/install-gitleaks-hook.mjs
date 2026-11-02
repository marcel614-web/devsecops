#!/usr/bin/env node
// scripts/install-gitleaks-hook.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(root, ".githooks", "pre-commit");

function run(bin, args, options = {}) {
  return execFileSync(bin, args, { encoding: "utf8", ...options }).trim();
}

try {
  execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    stdio: "ignore",
  });
} catch {
  console.error("Ce dossier n'est pas un dépôt Git.");
  process.exit(1);
}

if (!fs.existsSync(hook)) {
  console.error(`Hook introuvable : ${hook}`);
  process.exit(1);
}

run("git", ["config", "core.hooksPath", ".githooks"], { cwd: root });
if (process.platform !== "win32") {
  fs.chmodSync(hook, 0o755);
}

console.log("Hook Gitleaks activé (core.hooksPath = .githooks).");

const bin = process.env.GITLEAKS_BIN?.trim() || "gitleaks";
try {
  const version = run(bin, ["version"]);
  console.log(`Gitleaks détecté : ${version}`);
} catch {
  console.warn(
    `Gitleaks introuvable (${bin}). Le hook bloquera les commits tant qu'il ` +
      "n'est pas installé. Définissez GITLEAKS_BIN ou ajoutez-le au PATH.",
  );
}

console.log(
  "Test : indexez un faux secret puis lancez `git commit`. " +
    "Documentation : docs/gitleaks-hook.md",
);
