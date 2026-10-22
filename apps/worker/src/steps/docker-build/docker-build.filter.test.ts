// apps/worker/src/steps/docker-build/docker-build.filter.test.ts
import { describe, it, expect } from "vitest";
import { shouldIncludePath } from "./docker-build.step";

/**
 * L'archive envoyée à la VM est construite avec `COPY . .` dans la plupart
 * des Dockerfiles. Un `.env` ou une clé privée qui passe le filtre se
 * retrouve donc dans l'image déployée.
 */
describe("filtre d'archive de build — secrets", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production",
    "backend/.env",
    "certificates/server.pem",
    "certs/private.key",
    "id_rsa",
    "id_ed25519",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "credentials.json",
    "backup-avant-migration.dump",
  ])("exclut le fichier sensible %s", (file) => {
    expect(shouldIncludePath(file)).toBe(false);
  });

  it.each([
    ".env.example",
    ".env.sample",
    ".env.template",
    ".env.dist",
    "src/config.ts",
    "package.json",
    "README.md",
    "docker-compose.yml",
    "public/logo.png",
  ])("conserve le fichier légitime %s", (file) => {
    expect(shouldIncludePath(file)).toBe(true);
  });

  it("exclut les répertoires de dépendances et de credentials", () => {
    expect(shouldIncludePath("node_modules/react/index.js")).toBe(false);
    expect(shouldIncludePath(".git/config")).toBe(false);
    expect(shouldIncludePath(".ssh/id_rsa")).toBe(false);
    expect(shouldIncludePath(".aws/credentials")).toBe(false);
    expect(shouldIncludePath("dist/app.js")).toBe(false);
    expect(shouldIncludePath(".venv/lib/python3/site-packages/x.py")).toBe(false);
  });

  it("gère les séparateurs Windows", () => {
    expect(shouldIncludePath("backend\\.env")).toBe(false);
    expect(shouldIncludePath("backend\\src\\app.py")).toBe(true);
  });

  it("exclut les fichiers de log", () => {
    expect(shouldIncludePath("logs/app.log")).toBe(false);
    expect(shouldIncludePath("npm-debug.log")).toBe(false);
  });
});
