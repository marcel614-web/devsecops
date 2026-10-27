// apps/worker/src/steps/install-deps/install-deps.freeze.test.ts
import { describe, expect, it } from "vitest";
import { sanitizePipFreeze } from "./install-deps.step";
import { nodeInstallArgs } from "./node-dependencies";

/**
 * Le freeze est la cible de pip-audit dans l'étape SCA, exécutée sur
 * l'hôte. Il ne doit contenir que des épinglages sûrs : jamais `-e .`,
 * jamais d'URL directe, sinon pip-audit construirait le dépôt hors sandbox.
 */
describe("sanitizePipFreeze", () => {
  it("ne conserve que les épinglages nom==version", () => {
    const output = [
      "flask==3.0.0",
      "requests[security]==2.31.0",
      "-e .",
      "monprojet @ file:///workspace",
      "git+https://example.test/pkg.git",
      "package==1.0 ; python_version >= '3.10'",
      "# commentaire",
      "",
    ].join("\n");

    expect(sanitizePipFreeze(output)).toEqual([
      "flask==3.0.0",
      "requests[security]==2.31.0",
      "package==1.0",
    ]);
  });

  it("déduplique les paquets", () => {
    expect(sanitizePipFreeze("a==1\na==1\nb==2\n")).toEqual(["a==1", "b==2"]);
  });
});

describe("nodeInstallArgs", () => {
  it("utilise npm ci avec lockfile et ignore les scripts", () => {
    const args = nodeInstallArgs(true);
    expect(args[0]).toBe("ci");
    expect(args).toContain("--ignore-scripts");
    expect(args).not.toContain("--legacy-peer-deps");
  });

  it("utilise npm install sans lockfile", () => {
    const args = nodeInstallArgs(false);
    expect(args[0]).toBe("install");
    expect(args).toContain("--legacy-peer-deps");
  });
});
