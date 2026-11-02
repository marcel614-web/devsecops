// packages/scanners/src/scanners/gitleaks.parse.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@devsecops/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@devsecops/shared")>();
  return {
    ...actual,
    execTool: vi.fn(
      async (
        _bin: string,
        args: string[],
      ): Promise<{ stdout: string; stderr: string }> => {
        const index = args.indexOf("--report-path");
        if (index >= 0 && args[index + 1]) {
          const fs = await import("node:fs/promises");
          await fs.writeFile(args[index + 1], "{ ceci n'est pas du JSON", "utf8");
        }
        return { stdout: "", stderr: "" };
      },
    ),
  };
});

import { GitleaksScanner } from "./gitleaks.scanner";

describe("GitleaksScanner — rapport invalide", () => {
  it("retourne PARSE_ERROR au lieu d'un faux succès", async () => {
    const scanner = new GitleaksScanner();
    const result = await scanner.scan({ workspaceDir: process.cwd() });

    expect(result.status).toBe("FAILED");
    expect(result.outcome).toBe("PARSE_ERROR");
    expect(result.vulnerabilityCount).toBe(0);
    expect(result.error).toContain("Impossible de parser");
  });
});
