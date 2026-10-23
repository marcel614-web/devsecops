// packages/shared/src/network-errors.test.ts
import { describe, expect, it } from "vitest";
import { describeExecError, isTransientNetworkError } from "./network-errors";

describe("isTransientNetworkError", () => {
  it("reconnaît les pannes DNS et timeouts des outils", () => {
    for (const message of [
      "[Errno 11001] getaddrinfo failed",
      "Temporary failure in name resolution",
      "Could not resolve host: registry-1.docker.io",
      "urllib3.exceptions.ReadTimeoutError: Read timed out. (read timeout=15)",
      "Error: connect ETIMEDOUT 151.101.0.223:443",
      "ConnectionResetError: [Errno 104] Connection reset by peer",
      "dial tcp: lookup registry-1.docker.io on 127.0.0.53:53: i/o timeout",
    ]) {
      expect(isTransientNetworkError({ message })).toBe(true);
    }
  });

  it("reconnaît les erreurs HTTP transitoires des registres", () => {
    expect(isTransientNetworkError({ stderr: "HTTP Error 503: Service Unavailable" })).toBe(true);
    expect(isTransientNetworkError({ stderr: "status code: 502" })).toBe(true);
  });

  it("ne rejoue pas une erreur fonctionnelle", () => {
    expect(
      isTransientNetworkError({
        stderr:
          "ERROR: Could not find a version that satisfies the requirement flask==99.0.0",
      }),
    ).toBe(false);
    expect(
      isTransientNetworkError({ stderr: "npm ERR! 404 Not Found - GET /missing" }),
    ).toBe(false);
    expect(
      isTransientNetworkError({ stderr: "error: failed to solve: process did not complete successfully" }),
    ).toBe(false);
  });

  it("ignore une erreur sans sortie exploitable", () => {
    expect(isTransientNetworkError(undefined)).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError({ code: 2 })).toBe(false);
  });
});

describe("describeExecError", () => {
  it("privilégie stderr puis message", () => {
    expect(describeExecError({ stderr: "boom", message: "fallback" })).toBe("boom");
    expect(describeExecError({ message: "fallback" })).toBe("fallback");
    expect(describeExecError({})).toBe("erreur inconnue");
  });
});
