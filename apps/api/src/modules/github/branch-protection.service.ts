// apps/api/src/modules/github/branch-protection.service.ts
import { DEVSECOPS_CHECK_NAME } from "@devsecops/shared";
import { NotFoundError } from "../../utils/errors";
import { prisma } from "../../utils/prisma";
import {
  fetchInstallation,
  getInstallationOctokit,
} from "./github-app.service";

export { DEVSECOPS_CHECK_NAME };

const REQUIRED_PERMISSIONS = [
  "Administration: read (protections et rulesets de branche)",
  "Checks: write (publication du Check Run)",
  "Contents: read (lecture du dépôt)",
  "Metadata: read (implicite)",
] as const;

export interface BranchProtectionReport {
  repository: string;
  branch: string;
  observedAt: string;
  verifiable: boolean;
  reason: string | null;
  protectionEnabled: boolean | null;
  rulesets: Array<{ id: number; name: string; enforcement: string }>;
  rulesetsEnabled: boolean | null;
  requiredStatusChecks: string[];
  checkName: string;
  devSecOpsCheckRequired: boolean | null;
  strictUpToDate: boolean | null;
  enforceAdmins: boolean | null;
  requiredPermissions: readonly string[];
  appPermissions: Record<string, string>;
  missingPermissions: string[];
  correctiveSteps: string[];
  note: string;
}

function httpStatus(err: unknown): number | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status?: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Correspondance simple des motifs `refs/heads/*` des rulesets. */
export function matchesRefPattern(branch: string, pattern: string): boolean {
  const ref = `refs/heads/${branch}`;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(ref);
}

function rulesetAppliesToBranch(
  conditions: unknown,
  branch: string,
): boolean {
  if (!conditions || typeof conditions !== "object") return true;
  const refName = (conditions as { ref_name?: { include?: string[]; exclude?: string[] } })
    .ref_name;
  if (!refName) return true;

  const include = refName.include ?? [];
  const exclude = refName.exclude ?? [];

  if (exclude.some((pattern) => matchesRefPattern(branch, pattern))) {
    return false;
  }
  if (include.length === 0) return true;
  return include.some((pattern) => matchesRefPattern(branch, pattern));
}

export function buildReport(params: {
  repository: string;
  branch: string;
  protection: {
    enabled: boolean | null;
    requiredStatusChecks: string[];
    strictUpToDate: boolean | null;
    enforceAdmins: boolean | null;
  };
  rulesets: {
    verifiable: boolean;
    items: Array<{ id: number; name: string; enforcement: string }>;
    requiredStatusChecks: string[];
  };
  appPermissions: Record<string, string>;
  protectionError: unknown | null;
  rulesetsError: unknown | null;
}): BranchProtectionReport {
  const missingPermissions: string[] = [];
  if (params.appPermissions.administration !== "read" && params.appPermissions.administration !== "write") {
    missingPermissions.push("Administration: read");
  }
  if (params.appPermissions.checks !== "write") {
    missingPermissions.push("Checks: write");
  }
  if (
    params.appPermissions.contents !== "read" &&
    params.appPermissions.contents !== "write"
  ) {
    missingPermissions.push("Contents: read");
  }

  const protectionStatus = params.protectionError
    ? httpStatus(params.protectionError)
    : null;
  const rulesetsStatus = params.rulesetsError
    ? httpStatus(params.rulesetsError)
    : null;

  const permissionDenied =
    protectionStatus === 403 ||
    rulesetsStatus === 403 ||
    missingPermissions.length > 0;

  const protectionVerifiable =
    !params.protectionError || protectionStatus === 404;
  const rulesetsVerifiable =
    params.rulesets.verifiable ||
    (!params.rulesetsError && params.rulesets.items.length === 0);

  const verifiable =
    !permissionDenied && protectionVerifiable && rulesetsVerifiable;

  const requiredStatusChecks = [
    ...new Set([
      ...params.protection.requiredStatusChecks,
      ...params.rulesets.requiredStatusChecks,
    ]),
  ];

  const devSecOpsCheckRequired = verifiable
    ? requiredStatusChecks.includes(DEVSECOPS_CHECK_NAME)
    : null;

  const protectionEnabled =
    protectionStatus === 404 ? false : params.protection.enabled;
  const rulesetsEnabled = rulesetsStatus === 404
    ? false
    : verifiable || params.rulesets.items.length > 0
      ? params.rulesets.items.length > 0
      : null;

  const reason = !verifiable
    ? permissionDenied
      ? "Permissions GitHub insuffisantes pour vérifier les protections : le statut ne peut pas être considéré comme absent ni comme actif."
      : `Impossible de vérifier les protections de branche : ${errorText(
          params.protectionError ?? params.rulesetsError,
        )}`
    : null;

  const correctiveSteps: string[] = [];
  if (!verifiable) {
    correctiveSteps.push(
      "Accorder à la GitHub App la permission Administration: read (Repository permissions) puis réinstaller/actualiser l'installation.",
      "Vérifier que la permission Checks: write est accordée pour publier le Check Run.",
      "Relancer la vérification : tant que les permissions manquent, le statut reste « non vérifiable ».",
    );
  } else {
    if (!protectionEnabled && !rulesetsEnabled) {
      correctiveSteps.push(
        "Créer une protection de branche ou un ruleset sur la branche surveillée.",
      );
    }
    if (!devSecOpsCheckRequired) {
      correctiveSteps.push(
        `Ajouter « ${DEVSECOPS_CHECK_NAME} » comme status check obligatoire (branch protection ou ruleset).`,
      );
    }
    if (params.protection.enforceAdmins === false) {
      correctiveSteps.push(
        "Activer « Do not allow bypassing the above settings » pour appliquer les contrôles aux administrateurs.",
      );
    }
    correctiveSteps.push(
      "Un Check Run en échec ne bloque la fusion que si ce check est déclaré obligatoire par la protection/ruleset : le contrôle est vérifié ici, pas déduit du seul résultat du pipeline.",
    );
  }

  return {
    repository: params.repository,
    branch: params.branch,
    observedAt: new Date().toISOString(),
    verifiable,
    reason,
    protectionEnabled,
    rulesets: params.rulesets.items,
    rulesetsEnabled,
    requiredStatusChecks,
    checkName: DEVSECOPS_CHECK_NAME,
    devSecOpsCheckRequired,
    strictUpToDate: params.protection.strictUpToDate,
    enforceAdmins: params.protection.enforceAdmins,
    requiredPermissions: REQUIRED_PERMISSIONS,
    appPermissions: params.appPermissions,
    missingPermissions,
    correctiveSteps,
    note:
      "La vérification interroge la protection de branche et les rulesets via l'API GitHub. " +
      "Elle ne déduit jamais un blocage de fusion du seul résultat d'un Check Run.",
  };
}

async function loadRepository(userId: string, repositoryId: string) {
  const repo = await prisma.gitHubRepository.findFirst({
    where: { id: repositoryId, installation: { userId, revokedAt: null } },
    select: {
      fullName: true,
      owner: true,
      name: true,
      defaultBranch: true,
      installation: { select: { installationId: true } },
    },
  });
  if (!repo) throw new NotFoundError("Repository introuvable");
  return repo;
}

export async function inspectBranchProtection(
  userId: string,
  repositoryId: string,
  branch?: string,
): Promise<BranchProtectionReport> {
  const repo = await loadRepository(userId, repositoryId);
  const targetBranch = (branch ?? repo.defaultBranch).trim();
  if (!targetBranch || targetBranch.length > 255) {
    throw new NotFoundError("Branche invalide");
  }

  const installation = await fetchInstallation(
    repo.installation.installationId,
  );
  const appPermissions = (installation.permissions ?? {}) as Record<
    string,
    string
  >;

  const octokit = await getInstallationOctokit(
    repo.installation.installationId,
  );

  let protectionError: unknown | null = null;
  let protection = {
    enabled: null as boolean | null,
    requiredStatusChecks: [] as string[],
    strictUpToDate: null as boolean | null,
    enforceAdmins: null as boolean | null,
  };

  try {
    const { data } = await octokit.repos.getBranchProtection({
      owner: repo.owner,
      repo: repo.name,
      branch: targetBranch,
    });
    protection = {
      enabled: true,
      requiredStatusChecks:
        data.required_status_checks?.contexts ??
        data.required_status_checks?.checks?.map((check) => check.context) ??
        [],
      strictUpToDate: data.required_status_checks?.strict ?? null,
      enforceAdmins: data.enforce_admins?.enabled ?? null,
    };
  } catch (err) {
    // 404 = aucune protection classique. Ce n'est pas une erreur de
    // permission : les rulesets peuvent malgré tout protéger la branche.
    if (httpStatus(err) !== 404) protectionError = err;
  }

  let rulesetsError: unknown | null = null;
  let rulesetsVerifiable = true;
  const ruleItems: Array<{ id: number; name: string; enforcement: string }> = [];
  const rulesetChecks: string[] = [];

  try {
    const { data } = await octokit.repos.getRepoRulesets({
      owner: repo.owner,
      repo: repo.name,
      includes_parents: true,
      per_page: 100,
    });

    for (const ruleset of data) {
      if (ruleset.target && ruleset.target !== "branch") continue;
      if (ruleset.enforcement === "disabled") continue;

      try {
        const detail = await octokit.repos.getRepoRuleset({
          owner: repo.owner,
          repo: repo.name,
          ruleset_id: ruleset.id,
        });
        if (!rulesetAppliesToBranch(detail.data.conditions, targetBranch)) {
          continue;
        }
        ruleItems.push({
          id: ruleset.id,
          name: ruleset.name,
          enforcement: ruleset.enforcement,
        });
        for (const rule of detail.data.rules ?? []) {
          if (rule.type !== "required_status_checks") continue;
          const parameters = rule.parameters as
            | {
                required_status_checks?: Array<{ context?: string }>;
              }
            | undefined;
          for (const check of parameters?.required_status_checks ?? []) {
            if (check.context) rulesetChecks.push(check.context);
          }
        }
      } catch (err) {
        // Un ruleset supprimé entre la liste et le détail (404) n'est plus
        // actif : on peut l'ignorer. Toute autre erreur rend la vérification
        // partielle, car on ne peut pas affirmer que le check n'est pas
        // obligatoire.
        if (httpStatus(err) !== 404) {
          rulesetsError = err;
          rulesetsVerifiable = false;
        }
      }
    }
  } catch (err) {
    rulesetsError = err;
    rulesetsVerifiable = false;
  }

  return buildReport({
    repository: repo.fullName,
    branch: targetBranch,
    protection,
    rulesets: {
      verifiable: rulesetsVerifiable,
      items: ruleItems,
      requiredStatusChecks: rulesetChecks,
    },
    appPermissions,
    protectionError,
    rulesetsError,
  });
}
