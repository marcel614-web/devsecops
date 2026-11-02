#!/usr/bin/env node
// scripts/gitleaks-precommit.mjs
/**
 * Hook pre-commit local : bloque l'index si Gitleaks détecte un secret.
 *
 * Le scan porte uniquement sur les fichiers indexés (`--pre-commit --staged`).
 * Les secrets sont masqués dans la sortie et dans le rapport temporaire
 * (`--redact`). Le rapport JSON n'est jamais conservé dans le dépôt.
 *
 * Variables :
 *   GITLEAKS_BIN                   chemin explicite vers le binaire
 *   GITLEAKS_HOOK_ALLOW_MISSING=1  autorise un commit sans Gitleaks (déconseillé)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MIN_MAJOR = 8;
const ALLOW_MISSING = process.env.GITLEAKS_HOOK_ALLOW_MISSING === "1";

function gitRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

function gitleaksBin() {
  return process.env.GITLEAKS_BIN?.trim() || "gitleaks";
}

function run(bin, args, options = {}) {
  return execFileSync(bin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    ...options,
  });
}

function fail(message) {
  console.error(`\n[gitleaks pre-commit] ${message}\n`);
  process.exit(1);
}

const bin = gitleaksBin();

let rawVersion;
try {
  rawVersion = run(bin, ["version"]).trim();
} catch {
  if (ALLOW_MISSING) {
    console.warn(
      "[gitleaks pre-commit] Gitleaks introuvable — commit autorisé car " +
        "GITLEAKS_HOOK_ALLOW_MISSING=1. La plateforme reste la barrière de secours.",
    );
    process.exit(0);
  }
  fail(
    `Gitleaks est introuvable (binaire : ${bin}).\n` +
      "Installez Gitleaks 8.x, ajoutez-le au PATH ou définissez GITLEAKS_BIN.\n" +
      "Le commit est refusé par sécurité. Voir docs/gitleaks-hook.md.",
  );
}

const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(rawVersion);
if (!match || Number(match[1]) < MIN_MAJOR) {
  fail(
    `Version de Gitleaks non supportée : ${rawVersion}. ` +
      `La syntaxe utilisée nécessite Gitleaks >= ${MIN_MAJOR}.x ` +
      "(testée avec 8.30.0).",
  );
}

const root = gitRoot();
const reportPath = path.join(
  os.tmpdir(),
  `gitleaks-precommit-${process.pid}-${Date.now()}.json`,
);

// `process.exit()` ne déclenche pas `finally` : on garantit aussi le nettoyage
// du rapport temporaire (qui contient des valeurs redactées) à la sortie.
const cleanupReport = () => fs.rmSync(reportPath, { force: true });
process.once("exit", cleanupReport);

try {
  try {
    run(
      bin,
      [
        "git",
        "--pre-commit",
        "--staged",
        "--redact",
        "--no-banner",
        "--exit-code",
        "0",
        "--report-format",
        "json",
        "--report-path",
        reportPath,
      ],
      { cwd: root },
    );
  } catch (err) {
    const stderr = (err?.stderr ?? "").toString().trim();
    fail(
      "Le scan Gitleaks n'a pas pu s'exécuter ; le commit est refusé.\n" +
        (stderr ? `Détail : ${stderr}` : String(err?.message ?? err)),
    );
  }

  let findings;
  try {
    findings = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch {
    fail(
      "Le rapport Gitleaks est illisible ; impossible de garantir l'absence " +
        "de secret. Le commit est refusé.",
    );
  }

  if (!Array.isArray(findings)) {
    fail("Format de rapport Gitleaks inattendu ; commit refusé.");
  }

  if (findings.length === 0) {
    console.log(
      `[gitleaks pre-commit] OK — aucun secret détecté dans les fichiers indexés (Gitleaks ${rawVersion}).`,
    );
    process.exit(0);
  }

  console.error(
    `\n[gitleaks pre-commit] ${findings.length} secret(s) détecté(s) dans les fichiers indexés :`,
  );
  for (const finding of findings) {
    const file = finding.File ?? "(fichier inconnu)";
    const line = finding.StartLine ?? "?";
    const rule = finding.RuleID ?? "règle inconnue";
    console.error(`  - ${rule} — ${file}:${line} (valeur masquée)`);
  }
  console.error(
    "\nCommit refusé : retirez le secret, utilisez une variable d'environnement " +
      "ou un coffre-fort, puis réindexez le fichier.\n" +
      "Ne contournez pas avec --no-verify. Procédure : docs/gitleaks-hook.md\n",
  );
  process.exit(1);
} finally {
  cleanupReport();
}
