// apps/worker/src/orchestrator/scan-triage.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScanType, VulnerabilityStatus } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("../utils/prisma", () => ({
  prisma: {
    securityScan: {
      findMany: mocks.findMany,
      deleteMany: mocks.deleteMany,
    },
    vulnerability: {
      updateMany: mocks.updateMany,
    },
  },
}));

import {
  hasTriageInformation,
  restoreScanTriage,
  snapshotAndClearScan,
  type TriageSnapshot,
} from "./scan-triage";

describe("hasTriageInformation", () => {
  it("conserve un statut de triage", () => {
    expect(
      hasTriageInformation({
        status: VulnerabilityStatus.FALSE_POSITIVE,
        assignedToId: null,
        notes: null,
        dueDate: null,
      }),
    ).toBe(true);
  });

  it("conserve une assignation, une note ou une échéance", () => {
    expect(
      hasTriageInformation({
        status: VulnerabilityStatus.OPEN,
        assignedToId: "user-1",
        notes: null,
        dueDate: null,
      }),
    ).toBe(true);
    expect(
      hasTriageInformation({
        status: VulnerabilityStatus.OPEN,
        assignedToId: null,
        notes: "à vérifier",
        dueDate: null,
      }),
    ).toBe(true);
    expect(
      hasTriageInformation({
        status: VulnerabilityStatus.OPEN,
        assignedToId: null,
        notes: null,
        dueDate: new Date(),
      }),
    ).toBe(true);
  });

  it("ignore un finding OPEN sans aucun triage", () => {
    expect(
      hasTriageInformation({
        status: VulnerabilityStatus.OPEN,
        assignedToId: null,
        notes: "   ",
        dueDate: null,
      }),
    ).toBe(false);
  });
});

describe("snapshotAndClearScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sauvegarde le triage puis supprime les anciens scans", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "scan-1",
        vulnerabilities: [
          {
            fingerprint: "fp-1",
            status: VulnerabilityStatus.FALSE_POSITIVE,
            assignedToId: "user-1",
            notes: "faux positif confirmé",
            dueDate: new Date("2026-12-31"),
          },
          {
            fingerprint: "fp-2",
            status: VulnerabilityStatus.OPEN,
            assignedToId: null,
            notes: null,
            dueDate: null,
          },
        ],
      },
      {
        id: "scan-2",
        vulnerabilities: [
          {
            fingerprint: "fp-3",
            status: VulnerabilityStatus.OPEN,
            assignedToId: "user-2",
            notes: null,
            dueDate: null,
          },
        ],
      },
    ]);
    mocks.deleteMany.mockResolvedValue({ count: 2 });

    const snapshots = await snapshotAndClearScan("pipe-1", ScanType.SCA);

    expect(snapshots).toHaveLength(2);
    expect(snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fingerprint: "fp-1",
          status: VulnerabilityStatus.FALSE_POSITIVE,
          assignedToId: "user-1",
          notes: "faux positif confirmé",
        }),
        expect.objectContaining({
          fingerprint: "fp-3",
          assignedToId: "user-2",
        }),
      ]),
    );
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["scan-1", "scan-2"] } },
    });
  });

  it("ne supprime rien s'il n'y a pas d'ancien scan", async () => {
    mocks.findMany.mockResolvedValue([]);

    const snapshots = await snapshotAndClearScan("pipe-1", ScanType.SCA);

    expect(snapshots).toEqual([]);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});

describe("restoreScanTriage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("réapplique les champs de triage sur les nouveaux findings", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const snapshots: TriageSnapshot[] = [
      {
        fingerprint: "fp-1",
        status: VulnerabilityStatus.RISK_ACCEPTED,
        assignedToId: "user-1",
        notes: "accepté jusqu'à la prochaine release",
        dueDate: new Date("2026-12-31"),
      },
    ];

    const restored = await restoreScanTriage(
      "pipe-1",
      ScanType.SCA,
      snapshots,
    );

    expect(restored).toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        scan: { pipelineId: "pipe-1", type: ScanType.SCA },
        fingerprint: "fp-1",
      },
      data: {
        status: VulnerabilityStatus.RISK_ACCEPTED,
        assignedToId: "user-1",
        notes: "accepté jusqu'à la prochaine release",
        dueDate: new Date("2026-12-31"),
      },
    });
  });
});
