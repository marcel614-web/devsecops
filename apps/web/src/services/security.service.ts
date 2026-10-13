// apps/web/src/services/security.service.ts
import { api } from "./api";
import type { Pipeline, PipelineStatus, SecurityScan, Severity } from "@/types/api";

export interface SecurityOverview {
  recentScans: Array<
    SecurityScan & {
      pipeline: {
        id: string;
        project: { id: string; name: string };
        commitSha: string;
        branch: string;
      };
    }
  >;
  blockedPipelines: Array<Pipeline & {
    project: { id: string; name: string };
    gateResult: { reason: string | null } | null;
  }>;
  severityCounts: Record<Severity, number>;
}

export const securityService = {
  /**
   * Agrège les données de sécurité depuis les endpoints existants.
   * Note : on pourrait créer un endpoint backend dédié plus tard
   * (GET /api/security/overview) pour tout faire en un appel.
   */
  async overview(): Promise<SecurityOverview> {
    // Récupère tous les projets accessibles
    const projectsRes = await api.get<{ items: Array<{ id: string; name: string }> }>(
      "/api/projects",
      { params: { pageSize: 100 } },
    );
    const projects = projectsRes.data.items;

    // Pour chaque projet, récupère les pipelines récents
    const pipelinePromises = projects.map((p) =>
      api
        .get<{ items: Pipeline[] }>(`/api/projects/${p.id}/pipelines`, {
          params: { pageSize: 10 },
        })
        .then((r) => r.data.items.map((pl) => ({ ...pl, project: p })))
        .catch(() => []),
    );

    const allPipelines = (await Promise.all(pipelinePromises)).flat();

    // Trie par date décroissante
    allPipelines.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    // Récupère les scans pour les 10 derniers pipelines
    const recentPipelines = allPipelines.slice(0, 10);
    const scansPromises = recentPipelines.map((pl) =>
      api
        .get<{ scans: SecurityScan[] }>(
          `/api/projects/${pl.project.id}/pipelines/${pl.id}/scans`,
        )
        .then((r) =>
          r.data.scans.map((s) => ({
            ...s,
            pipeline: {
              id: pl.id,
              project: pl.project,
              commitSha: pl.commitSha,
              branch: pl.branch,
            },
          })),
        )
        .catch(() => []),
    );
    const recentScans = (await Promise.all(scansPromises)).flat();

    // Agrège les compteurs de sévérité sur ces scans
    const severityCounts: Record<Severity, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    };
    for (const s of recentScans) {
      severityCounts.CRITICAL += s.criticalCount;
      severityCounts.HIGH += s.highCount;
      severityCounts.MEDIUM += s.mediumCount;
      severityCounts.LOW += s.lowCount;
      severityCounts.INFO += s.infoCount;
    }

    // Pipelines bloqués
    const blockedPipelines = allPipelines
      .filter((pl) => pl.status === "SECURITY_BLOCKED")
      .slice(0, 10)
      .map((pl) => ({
        ...pl,
        gateResult: null as { reason: string | null } | null,
      }));

    return {
      recentScans: recentScans.slice(0, 20),
      blockedPipelines,
      severityCounts,
    };
  },
};