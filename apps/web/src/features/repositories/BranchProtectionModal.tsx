import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useBranchProtection, useGithubBranches } from "@/hooks/useGithub";
import { getErrorMessage } from "@/services/api";
import { cn } from "@/lib/utils";
import type { GitHubRepository } from "@/services/github.service";

type Props = {
  repository: GitHubRepository;
  onClose: () => void;
};

function StateBadge({
  state,
  trueLabel,
  falseLabel = "Absent",
}: {
  state: boolean | null;
  trueLabel: string;
  falseLabel?: string;
}) {
  if (state === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        <ShieldQuestion className="h-3.5 w-3.5" /> Non vérifiable
      </span>
    );
  }
  return state ? (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-3.5 w-3.5" /> {trueLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
      <XCircle className="h-3.5 w-3.5" /> {falseLabel}
    </span>
  );
}

/**
 * Vérification des protections de branche.
 *
 * Cet écran distingue explicitement trois choses :
 *  - les protections réellement configurées sur GitHub ;
 *  - le caractère obligatoire du Check Run DevSecOps ;
 *  - l'impossibilité de vérifier (permissions insuffisantes), qui ne doit
 *    jamais être présentée comme « pas de protection ».
 */
export function BranchProtectionModal({ repository, onClose }: Props) {
  const [branch, setBranch] = useState(repository.defaultBranch);
  const branches = useGithubBranches(repository.id);
  const { data, isLoading, isFetching, isError, error, refetch } =
    useBranchProtection(repository.id, branch, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-protection-title"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="branch-protection-title" className="text-lg font-semibold">
              Protections de branche
            </h2>
            <p className="mt-0.5 font-mono text-xs text-muted">
              {repository.fullName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-md p-1.5 text-muted hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="protection-branch"
                className="mb-1.5 block text-sm font-medium"
              >
                Branche
              </label>
              <Select
                id="protection-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={branches.isLoading}
              >
                {branches.isLoading && <option value={branch}>Chargement…</option>}
                {branches.data?.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.protected ? " (protégée)" : ""}
                  </option>
                ))}
                {!branches.data?.some((b) => b.name === branch) && (
                  <option value={branch}>{branch}</option>
                )}
              </Select>
            </div>
            <Button
              variant="secondary"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-2"
            >
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              Revérifier
            </Button>
          </div>

          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-32 rounded-lg" />
            </div>
          )}

          {isError && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400"
            >
              <p className="font-medium">Vérification impossible</p>
              <p className="mt-1 text-xs">{getErrorMessage(error)}</p>
            </div>
          )}

          {data && (
            <>
              <div
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between",
                  data.verifiable
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-amber-500/30 bg-amber-500/5",
                )}
              >
                <div className="flex items-center gap-2">
                  {data.verifiable ? (
                    <ShieldCheck className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-amber-500" />
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      {data.verifiable
                        ? "État vérifié auprès de GitHub"
                        : "État non vérifiable"}
                    </p>
                    <p className="text-xs text-muted">
                      {data.repository} · {data.branch}
                    </p>
                  </div>
                </div>
                {!data.verifiable && (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> Ne pas interpréter comme « absent »
                  </span>
                )}
              </div>

              {!data.verifiable && data.reason && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  {data.reason}
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted">Protection de branche classique</p>
                  <div className="mt-1.5">
                    <StateBadge
                      state={data.verifiable ? data.protectionEnabled : null}
                      trueLabel="Active"
                      falseLabel="Absente"
                    />
                  </div>
                  {data.strictUpToDate !== null && (
                    <p className="mt-1 text-xs text-muted">
                      Branche à jour requise : {data.strictUpToDate ? "oui" : "non"}
                    </p>
                  )}
                  {data.enforceAdmins !== null && (
                    <p className="text-xs text-muted">
                      Administrateurs soumis : {data.enforceAdmins ? "oui" : "non"}
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted">Rulesets</p>
                  <div className="mt-1.5">
                    <StateBadge
                      state={data.verifiable ? data.rulesetsEnabled : null}
                      trueLabel={`${data.rulesets.length} actif(s)`}
                      falseLabel="Aucun"
                    />
                  </div>
                  {data.rulesets.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
                      {data.rulesets.map((ruleset) => (
                        <li key={ruleset.id} className="truncate">
                          {ruleset.name} ({ruleset.enforcement})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-lg border border-border p-3 sm:col-span-2">
                  <p className="text-xs text-muted">
                    Check Run DevSecOps obligatoire
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StateBadge
                      state={data.devSecOpsCheckRequired}
                      trueLabel="Obligatoire"
                      falseLabel="Non obligatoire"
                    />
                    <span className="font-mono text-xs text-muted">
                      {data.checkName}
                    </span>
                  </div>
                  {data.requiredStatusChecks.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-xs font-medium">Checks requis :</p>
                      <ul className="mt-1 space-y-0.5">
                        {data.requiredStatusChecks.map((check) => (
                          <li
                            key={check}
                            className={cn(
                              "font-mono text-xs",
                              check === data.checkName
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-muted",
                            )}
                          >
                            {check}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted">
                      Aucun status check requis n'a pu être lu.
                    </p>
                  )}
                </div>
              </div>

              {!data.verifiable && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" />
                    Permissions GitHub manquantes
                  </p>
                  {data.missingPermissions.length > 0 ? (
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs">
                      {data.missingPermissions.map((permission) => (
                        <li key={permission}>{permission}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs">
                      L'API GitHub a refusé la lecture des protections.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted">
                    Permissions requises par la GitHub App :
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
                    {data.requiredPermissions.map((permission) => (
                      <li key={permission}>{permission}</li>
                    ))}
                  </ul>
                </div>
              )}

              {data.correctiveSteps.length > 0 && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">Étapes correctives</p>
                  <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-xs text-muted">
                    {data.correctiveSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-lg bg-slate-100 p-3 text-xs text-muted dark:bg-slate-800">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{data.note}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
