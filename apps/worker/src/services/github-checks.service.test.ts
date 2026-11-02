// apps/worker/src/services/github-checks.service.test.ts
import { PipelineStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { conclusionFor } from "./github-checks.service";

describe("conclusion du Check Run GitHub", () => {
  it("publie un succès uniquement pour un pipeline réussi", () => {
    expect(conclusionFor(PipelineStatus.SUCCESS)).toBe("success");
  });

  it("publie un échec pour un gate bloquant ou un pipeline en échec", () => {
    expect(conclusionFor(PipelineStatus.FAILED)).toBe("failure");
    expect(conclusionFor(PipelineStatus.SECURITY_BLOCKED)).toBe("failure");
  });

  it("ne transforme pas un pipeline interrompu en succès", () => {
    expect(conclusionFor(PipelineStatus.CANCELLED)).toBe("cancelled");
    expect(conclusionFor(PipelineStatus.TIMED_OUT)).toBe("timed_out");
  });

  it("reste non bloquant pour un succès avec avertissements", () => {
    expect(conclusionFor(PipelineStatus.SUCCESS_WITH_WARNINGS)).toBe("neutral");
  });

  it("ne déclare pas un succès pour un pipeline encore en cours ou en attente", () => {
    expect(conclusionFor(PipelineStatus.QUEUED)).toBe("neutral");
    expect(conclusionFor(PipelineStatus.RUNNING)).toBe("neutral");
    expect(conclusionFor(PipelineStatus.WAITING_APPROVAL)).toBe(
      "action_required",
    );
  });
});
