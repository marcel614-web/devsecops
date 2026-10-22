// apps/worker/src/steps/security-gate/security-gate.exceptions.test.ts
import { describe, expect, it } from "vitest";
import {
  emptySeverityCounts,
  exceptionMatchesFinding,
} from "./security-gate.step";

const finding = {
  severity: "CRITICAL",
  fingerprint: "hash-abc",
  reference: "CVE-2024-1234",
};

describe("exceptionMatchesFinding", () => {
  it("ignore une exception sans fingerprint (fail-closed)", () => {
    // C'était le bug : une exception { category: SCA, severity: CRITICAL }
    // supprimait tous les findings CRITICAL de SCA.
    expect(
      exceptionMatchesFinding(
        { category: "SCA", severity: "CRITICAL", fingerprint: null },
        finding,
        "SCA",
      ),
    ).toBe(false);
  });

  it("accepte une correspondance par référence CVE", () => {
    expect(
      exceptionMatchesFinding(
        {
          category: "SCA",
          severity: "CRITICAL",
          fingerprint: "CVE-2024-1234",
        },
        finding,
        "SCA",
      ),
    ).toBe(true);
  });

  it("accepte une correspondance par empreinte", () => {
    expect(
      exceptionMatchesFinding(
        {
          category: "ALL",
          severity: null,
          fingerprint: "hash-abc",
        },
        finding,
        "SCA",
      ),
    ).toBe(true);
  });

  it("refuse une catégorie différente", () => {
    expect(
      exceptionMatchesFinding(
        { category: "SAST", severity: null, fingerprint: "CVE-2024-1234" },
        finding,
        "SCA",
      ),
    ).toBe(false);
  });

  it("refuse une sévérité différente", () => {
    expect(
      exceptionMatchesFinding(
        { category: "SCA", severity: "LOW", fingerprint: "CVE-2024-1234" },
        finding,
        "SCA",
      ),
    ).toBe(false);
  });

  it("refuse un finding différent", () => {
    expect(
      exceptionMatchesFinding(
        { category: "SCA", severity: null, fingerprint: "CVE-2024-9999" },
        finding,
        "SCA",
      ),
    ).toBe(false);
  });

  it("est insensible à la casse", () => {
    expect(
      exceptionMatchesFinding(
        { category: "SCA", severity: null, fingerprint: "cve-2024-1234" },
        finding,
        "SCA",
      ),
    ).toBe(true);
  });
});

describe("emptySeverityCounts", () => {
  it("retourne un compteur neuf à chaque appel", () => {
    const a = emptySeverityCounts();
    const b = emptySeverityCounts();
    a.critical = 3;
    expect(b.critical).toBe(0);
  });
});
