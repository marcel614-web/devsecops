// apps/worker/src/rescan/rescan.notifications.test.ts
import { describe, expect, it } from "vitest";
import { compareRescanFindings } from "./rescan.comparison";
import {
  buildRescanFailureNotification,
  buildRescanRiskNotification,
} from "./rescan.notifications";

describe("buildRescanRiskNotification", () => {
  it("retourne null sans risque", () => {
    const comparison = compareRescanFindings([], [], { baselineAvailable: true });
    expect(
      buildRescanRiskNotification({
        projectId: "p1",
        projectName: "Demo",
        rescanRunId: "r1",
        commitSha: "1234567890abcdef",
        imageTag: "demo:1",
        comparison,
      }),
    ).toBeNull();
  });

  it("génère une notification lors d'un nouveau risque", () => {
    const comparison = compareRescanFindings(
      [],
      [{ fingerprint: "n", severity: "CRITICAL", tool: "trivy" }],
      { baselineAvailable: true },
    );
    const content = buildRescanRiskNotification({
      projectId: "p1",
      projectName: "Demo",
      rescanRunId: "r1",
      commitSha: "1234567890abcdef",
      imageTag: "demo:1",
      comparison,
    });
    expect(content).not.toBeNull();
    expect(content?.kind).toBe("DANGER");
    expect(content?.sourceKey).toBe("rescan-risk:r1");
  });
});

describe("buildRescanFailureNotification", () => {
  it("génère une notification d'échec", () => {
    const content = buildRescanFailureNotification({
      projectId: "p1",
      projectName: "Demo",
      rescanRunId: "r2",
      imageTag: "demo:1",
      error: "network timeout",
    });
    expect(content.title).toContain("échec");
    expect(content.message).toContain("network timeout");
    expect(content.sourceKey).toBe("rescan-failed:r2");
  });
});