// apps/worker/src/rescan/rescan.policy.test.ts
import { describe, expect, it } from "vitest";
import {
  cycleKeyFor,
  dailyLimitReached,
  normalizeRescanControls,
} from "./rescan.policy";

describe("normalizeRescanControls", () => {
  it("ne conserve que IMAGE", () => {
    expect(normalizeRescanControls(["image", "IAC", "IMAGE"])).toEqual(["IMAGE"]);
  });

  it("retourne vide si aucun contrôle supporté", () => {
    expect(normalizeRescanControls(["IAC"])).toEqual([]);
  });
});

describe("dailyLimitReached", () => {
  it("bloque à partir de la limite", () => {
    expect(dailyLimitReached(2, 2)).toBe(true);
    expect(dailyLimitReached(1, 2)).toBe(false);
  });
});

describe("cycleKeyFor", () => {
  it("produit une clé stable par échéance", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(cycleKeyFor(date)).toBe(date.toISOString());
  });
});