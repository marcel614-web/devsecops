// apps/worker/src/steps/install-deps/install-deps.retry.test.ts
import { describe, expect, it } from "vitest";
import { isTransientNetworkError } from "./install-deps.step";

/**
 * `pip install` peut échouer sur une panne DNS intermittente
 * (`getaddrinfo failed`). Ces erreurs doivent être rejouées ; les erreurs
 * fonctionnelles (version absente, build cassé) ne doivent pas l'être.
 */
describe("isTransientNetworkError", () => {
  it("reconnaît l'échec de résolution DNS observé sur le worker", () => {
    const err = {
      code: 1,
      stderr:
        "Could not fetch URL https://pypi.org/simple/flask/: " +
        "connection error - [Errno 11001] getaddrinfo failed",
    };
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("reconnaît les délais d'attente et connexions coupées", () => {
    for (const message of [
      "HTTPSConnectionPool(host='pypi.org', port=443): Read timed out.",
      "ConnectionResetError: [Errno 104] Connection reset by peer",
      "socket.timeout: The read operation timed out",
      "NewConnectionError: Failed to establish a new connection",
      "Temporary failure in name resolution",
      "requests.exceptions.SSLError: EOF occurred in violation of protocol",
    ]) {
      expect(isTransientNetworkError({ message })).toBe(true);
    }
  });

  it("ne rejoue pas une erreur fonctionnelle", () => {
    const err = {
      code: 1,
      stderr:
        "ERROR: Could not find a version that satisfies the requirement " +
        "flask==99.0.0 (from versions: 3.1.2)",
    };
    expect(isTransientNetworkError(err)).toBe(false);
  });

  it("ignore une erreur sans sortie exploitable", () => {
    expect(isTransientNetworkError(undefined)).toBe(false);
    expect(isTransientNetworkError({ code: 2 })).toBe(false);
  });
});
