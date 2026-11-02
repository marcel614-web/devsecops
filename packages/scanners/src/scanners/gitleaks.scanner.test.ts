// packages/scanners/src/scanners/gitleaks.scanner.test.ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitleaksScanner } from "./gitleaks.scanner";

const SECRET = "xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx";
const scanner = new GitleaksScanner();
let workspace: string | null = null;

afterEach(async () => {
  if (workspace) {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    workspace = null;
  }
});

describe("GitleaksScanner", () => {
  it("détecte un secret réel et le masque dans le résultat persistable", async (ctx) => {
    if (!(await scanner.isAvailable())) {
      ctx.skip();
      return;
    }

    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "gitleaks-test-"));
    await fs.writeFile(
      path.join(workspace, "app.env"),
      `SLACK_TOKEN=${SECRET}\n`,
      "utf8",
    );

    const result = await scanner.scan({ workspaceDir: workspace });

    expect(result.status).toBe("SUCCESS");
    expect(result.vulnerabilityCount).toBe(1);
    expect(result.findings[0]?.tool).toBe("gitleaks");
    expect(result.findings[0]?.severity).toBe("CRITICAL");
    expect(result.findings[0]?.reference).toBe("gitleaks:slack-bot-token");

    // Le secret ne doit jamais être conservé dans les données normalisées.
    expect(JSON.stringify(result.findings)).not.toContain(SECRET);
    expect(JSON.stringify(result.findings)).not.toContain(
      SECRET.replace("xoxb-", ""),
    );
  }, 60_000);

  it("échoue clairement lorsque Gitleaks ne peut pas scanner le dossier", async (ctx) => {
    if (!(await scanner.isAvailable())) {
      ctx.skip();
      return;
    }

    const result = await scanner.scan({
      workspaceDir: path.join(os.tmpdir(), "gitleaks-inexistant-" + Date.now()),
    });

    expect(result.status).toBe("FAILED");
    // Un échec d'exécution n'est jamais un succès à zéro finding.
    expect(result.outcome).not.toBe("SUCCESS_NO_FINDINGS");
    expect(result.vulnerabilityCount).toBe(0);
  }, 60_000);
});
