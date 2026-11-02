// apps/api/src/modules/webhooks/webhook-validation.ts
import { isFullGitSha } from "@devsecops/shared";

export type PushValidation =
  | { ok: true; branch: string; commitSha: string }
  | { ok: false; reason: string };

/**
 * Un push ne peut déclencher un déploiement que s'il cible une branche, que
 * le SHA de destination est un commit complet et qu'il ne s'agit pas d'une
 * suppression de branche.
 */
export function validatePush(payload: {
  ref?: string;
  after?: string;
  deleted?: boolean;
}): PushValidation {
  if (!payload.ref?.startsWith("refs/heads/")) {
    return { ok: false, reason: "not_a_branch" };
  }

  const branch = payload.ref.slice("refs/heads/".length);
  const commitSha = payload.after ?? "";

  if (
    !branch ||
    payload.deleted === true ||
    !isFullGitSha(commitSha) ||
    /^0+$/u.test(commitSha)
  ) {
    return { ok: false, reason: "invalid_commit_or_deletion" };
  }

  return { ok: true, branch, commitSha };
}

/**
 * Une PR issue d'un fork ne doit jamais exécuter du code non maîtrisé sur
 * nos runners. Le dépôt de tête doit être exactement le dépôt de base.
 */
export function isSameRepositoryPullRequest(payload: {
  repository: { full_name: string };
  pull_request: {
    head: { repo?: { full_name?: string } | null };
  };
}): boolean {
  return (
    payload.pull_request.head.repo?.full_name === payload.repository.full_name
  );
}
