// apps/api/src/modules/pipelines/pipelines.schema.test.ts
import { describe, it, expect } from "vitest";
import { runPipelineSchema } from "./pipelines.schema";

describe("runPipelineSchema — commitSha", () => {
  it("accepte un SHA Git valide", () => {
    const result = runPipelineSchema.safeParse({
      commitSha: "e83c5163316f89bfbde7d9ab23ca2e25604af290",
    });
    expect(result.success).toBe(true);
  });

  it("refuse un SHA court", () => {
    expect(runPipelineSchema.safeParse({ commitSha: "e83c516" }).success).toBe(
      false,
    );
  });

  it("accepte un SHA complet de 64 caractères", () => {
    expect(
      runPipelineSchema.safeParse({ commitSha: "a".repeat(64) }).success,
    ).toBe(true);
  });

  it("accepte l'absence de commit SHA (résolution automatique)", () => {
    expect(runPipelineSchema.safeParse({}).success).toBe(true);
  });

  it.each([
    ['"; id; "', "injection par guillemet"],
    ["abc\"; rm -rf / #", "injection par suffixe de commande"],
    ["$(whoami)", "substitution de commande"],
    ["`id`", "backtick"],
    ["abc def", "espace"],
    ["abcdefg\nid", "saut de ligne"],
    ["abc", "trop court"],
    ["z".repeat(40), "non hexadécimal"],
    ["a".repeat(41), "trop long"],
  ])("refuse commitSha=%s (%s)", (commitSha) => {
    const result = runPipelineSchema.safeParse({ commitSha });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/hexadécimal/i);
    }
  });
});

describe("runPipelineSchema — autres champs", () => {
  it("refuse une URL de pull request invalide", () => {
    const result = runPipelineSchema.safeParse({
      pullRequestUrl: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });

  it("refuse une URL de pull request en HTTP", () => {
    const result = runPipelineSchema.safeParse({
      pullRequestUrl: "http://github.com/acme/demo/pull/42",
    });
    expect(result.success).toBe(false);
  });

  it("refuse un numéro de pull request négatif", () => {
    const result = runPipelineSchema.safeParse({ pullRequestNumber: -1 });
    expect(result.success).toBe(false);
  });

  it("accepte une configuration complète valide", () => {
    const result = runPipelineSchema.safeParse({
      commitSha: "e83c5163316f89bfbde7d9ab23ca2e25604af290",
      branch: "feature/x",
      author: "dev@example.com",
      trigger: "manual",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/acme/demo/pull/42",
      baseBranch: "main",
    });
    expect(result.success).toBe(true);
  });
});
