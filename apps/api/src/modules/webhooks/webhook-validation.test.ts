// apps/api/src/modules/webhooks/webhook-validation.test.ts
import { describe, expect, it } from "vitest";
import {
  isSameRepositoryPullRequest,
  validatePush,
} from "./webhook-validation";

const SHA = "a".repeat(40);

describe("validation d'un push GitHub", () => {
  it("accepte une branche avec un commit complet", () => {
    expect(
      validatePush({ ref: "refs/heads/main", after: SHA, deleted: false }),
    ).toEqual({ ok: true, branch: "main", commitSha: SHA });
  });

  it.each([
    ["tag", { ref: "refs/tags/v1.0.0", after: SHA }],
    ["suppression", { ref: "refs/heads/main", after: "0".repeat(40), deleted: true }],
    ["SHA court", { ref: "refs/heads/main", after: "abc123" }],
    ["SHA absent", { ref: "refs/heads/main", after: undefined }],
    ["branche vide", { ref: "refs/heads/", after: SHA }],
  ])("refuse %s", (_label, payload) => {
    expect(validatePush(payload).ok).toBe(false);
  });

  it("refuse un SHA composé uniquement de zéros", () => {
    expect(validatePush({ ref: "refs/heads/main", after: "0".repeat(40) }).ok).toBe(
      false,
    );
  });
});

describe("validation d'une Pull Request", () => {
  const base = {
    repository: { full_name: "acme/demo" },
    pull_request: { head: { repo: { full_name: "acme/demo" } } },
  };

  it("accepte une branche du même dépôt", () => {
    expect(isSameRepositoryPullRequest(base)).toBe(true);
  });

  it("refuse un fork et un dépôt de tête supprimé", () => {
    expect(
      isSameRepositoryPullRequest({
        ...base,
        pull_request: { head: { repo: { full_name: "attaquant/demo" } } },
      }),
    ).toBe(false);
    expect(
      isSameRepositoryPullRequest({
        ...base,
        pull_request: { head: { repo: null } },
      }),
    ).toBe(false);
  });
});
