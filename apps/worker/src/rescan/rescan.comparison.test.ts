// apps/worker/src/rescan/rescan.comparison.test.ts
import { describe, expect, it } from "vitest";
import { compareRescanFindings } from "./rescan.comparison";

describe("compareRescanFindings", () => {
  it("détecte un nouveau résultat lorsque la baseline existe", () => {
    const comparison = compareRescanFindings(
      [{ fingerprint: "a", severity: "LOW", tool: "trivy" }],
      [
        { fingerprint: "a", severity: "LOW", tool: "trivy" },
        { fingerprint: "b", severity: "HIGH", tool: "trivy" },
      ],
      { baselineAvailable: true },
    );
    expect(comparison.counts.new).toBe(1);
    expect(comparison.riskFound).toBe(true);
  });

  it("ne qualifie pas de nouveau résultat sans baseline", () => {
    const comparison = compareRescanFindings(
      [],
      [{ fingerprint: "b", severity: "HIGH", tool: "trivy" }],
      { baselineAvailable: false },
    );
    expect(comparison.counts.new).toBe(0);
    expect(comparison.riskFound).toBe(false);
  });

  it("détecte une aggravation de sévérité", () => {
    const comparison = compareRescanFindings(
      [{ fingerprint: "a", severity: "MEDIUM", tool: "trivy" }],
      [{ fingerprint: "a", severity: "CRITICAL", tool: "trivy" }],
      { baselineAvailable: true },
    );
    expect(comparison.counts.severityIncreased).toBe(1);
    expect(comparison.counts.increasedToHighOrCritical).toBe(1);
    expect(comparison.riskFound).toBe(true);
  });

  it("détecte un résultat résolu", () => {
    const comparison = compareRescanFindings(
      [{ fingerprint: "a", severity: "HIGH", tool: "trivy" }],
      [],
      { baselineAvailable: true },
    );
    expect(comparison.counts.resolved).toBe(1);
  });
});