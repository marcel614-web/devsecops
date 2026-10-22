// packages/scanners/src/severity/osv.test.ts
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  scoreToSeverity,
  cvssVectorToScore,
  severityFromOsvVuln,
  fetchOsvSeverities,
  osvVulnUrl,
  FALLBACK_SEVERITY,
} from "./osv";

describe("scoreToSeverity", () => {
  it.each([
    [9.8, "CRITICAL"],
    [9.0, "CRITICAL"],
    [8.8, "HIGH"],
    [7.0, "HIGH"],
    [6.9, "MEDIUM"],
    [4.0, "MEDIUM"],
    [3.9, "LOW"],
    [0.1, "LOW"],
    [0, "INFO"],
  ] as const)("score %s → %s", (score, expected) => {
    expect(scoreToSeverity(score)).toBe(expected);
  });

  it("retourne la sévérité de repli pour un score invalide", () => {
    expect(scoreToSeverity(Number.NaN)).toBe(FALLBACK_SEVERITY);
  });

  it("n'utilise jamais MEDIUM comme repli (conservateur)", () => {
    // Un repli à MEDIUM neutraliserait les seuils high/critical du gate.
    expect(FALLBACK_SEVERITY).toBe("HIGH");
  });
});

describe("cvssVectorToScore", () => {
  it("calcule un score critique (RCE réseau)", () => {
    // CVE-2021-44228 (Log4Shell) : CVSS 3.1 = 10.0
    const score = cvssVectorToScore(
      "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H",
    );
    expect(score).toBe(10);
  });

  it("calcule un score élevé", () => {
    const score = cvssVectorToScore(
      "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
    );
    expect(score).toBe(7.5);
  });

  it("calcule un score moyen", () => {
    // CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N → 6.5 (MEDIUM)
    // La spécification CVSS v3.1 impose un arrondi AU SUPÉRIEUR
    // (Roundup) à une décimale : 6.4011 → 6.5.
    const score = cvssVectorToScore(
      "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N",
    );
    expect(score).toBe(6.5);
    expect(scoreToSeverity(score!)).toBe("MEDIUM");
  });

  it("calcule un score faible pour un vecteur très contraint", () => {
    // CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:L/A:N → 2.9 (LOW)
    const score = cvssVectorToScore(
      "CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:L/A:N",
    );
    expect(score).toBe(2.9);
    expect(scoreToSeverity(score!)).toBe("LOW");
  });

  it("retourne null pour un vecteur invalide", () => {
    expect(cvssVectorToScore("")).toBeNull();
    expect(cvssVectorToScore("pas un vecteur")).toBeNull();
    expect(cvssVectorToScore("CVSS:3.1/AV:X")).toBeNull();
  });

  it("retourne null pour une version inconnue", () => {
    expect(cvssVectorToScore("CVSS:4.0/AV:N/AC:L")).toBeNull();
  });
});

describe("severityFromOsvVuln", () => {
  it("utilise le vecteur CVSS quand il est présent", () => {
    const severity = severityFromOsvVuln({
      id: "CVE-2021-44228",
      severity: [
        { type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H" },
      ],
    });
    expect(severity).toBe("CRITICAL");
  });

  it("utilise un score numérique direct", () => {
    const severity = severityFromOsvVuln({
      id: "GHSA-xxxx",
      severity: [{ type: "CVSS_V3", score: "7.5" }],
    });
    expect(severity).toBe("HIGH");
  });

  it("utilise la sévérité déclarée par la base", () => {
    const severity = severityFromOsvVuln({
      id: "GHSA-yyyy",
      database_specific: { severity: "MODERATE" },
    });
    expect(severity).toBe("MEDIUM");
  });

  it("retourne null si aucune information n'est disponible", () => {
    expect(severityFromOsvVuln({ id: "PYSEC-0000" })).toBeNull();
  });
});

describe("fetchOsvSeverities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("construit l'URL de fiche OSV, pas une requête package", () => {
    expect(osvVulnUrl("CVE-2021-44228")).toBe(
      "https://api.osv.dev/v1/vulns/CVE-2021-44228",
    );
    expect(osvVulnUrl("GHSA-xxxx/yyyy")).toContain("GHSA-xxxx%2Fyyyy");
  });

  it("récupère la sévérité via /v1/vulns/{id}", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(
        "https://api.osv.dev/v1/vulns/CVE-2021-44228",
      );
      return new Response(
        JSON.stringify({
          id: "CVE-2021-44228",
          aliases: ["GHSA-jfh8-c2jp-5v3q"],
          severity: [
            {
              type: "CVSS_V3",
              score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const severities = await fetchOsvSeverities(["CVE-2021-44228"]);

    expect(severities.get("CVE-2021-44228")).toBe("CRITICAL");
    expect(severities.get("GHSA-jfh8-c2jp-5v3q")).toBe("CRITICAL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignore un identifiant inconnu (404) sans annuler les autres", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        if (String(url).endsWith("CVE-INCONNUE")) {
          return new Response("not found", { status: 404 });
        }
        return new Response(
          JSON.stringify({
            id: "CVE-2024-0001",
            database_specific: { severity: "HIGH" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const severities = await fetchOsvSeverities([
      "CVE-INCONNUE",
      "CVE-2024-0001",
    ]);

    expect(severities.has("CVE-INCONNUE")).toBe(false);
    expect(severities.get("CVE-2024-0001")).toBe("HIGH");
  });

  it("tolère une erreur réseau sur un identifiant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        if (String(url).endsWith("CVE-ERREUR")) {
          return new Response("boom", { status: 500 });
        }
        return new Response(
          JSON.stringify({
            id: "GHSA-ok",
            severity: [{ type: "CVSS_V3", score: "5.0" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const severities = await fetchOsvSeverities(["CVE-ERREUR", "GHSA-ok"]);

    expect(severities.has("CVE-ERREUR")).toBe(false);
    expect(severities.get("GHSA-ok")).toBe("MEDIUM");
  });
});
