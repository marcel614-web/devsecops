// apps/web/src/features/organizations/AddTeamRepoModal.tsx
import { useEffect, useMemo, useState } from "react";
import { X, Github, Lock, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SimpleBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/feedback/Toast";
import {
  useAvailableTeamRepos,
  useSetTeamRepoPermission,
} from "@/hooks/useGithub";
import { getErrorMessage } from "@/services/api";
import { cn } from "@/lib/utils";
import type { GitHubRepoPermission } from "@/services/github.service";

const PERMISSIONS: Array<{ value: GitHubRepoPermission; label: string }> = [
  { value: "pull", label: "pull — lecture" },
  { value: "triage", label: "triage — gestion des issues/PR" },
  { value: "push", label: "push — écriture" },
  { value: "maintain", label: "maintain — maintenance" },
  { value: "admin", label: "admin — administration" },
];

interface Props {
  installationId: string;
  slug: string;
  teamName: string;
  existingFullNames: string[];
  canManage: boolean;
  onClose: () => void;
  onAdded: (message: string) => void;
}

export function AddTeamRepoModal({
  installationId,
  slug,
  teamName,
  existingFullNames,
  canManage,
  onClose,
  onAdded,
}: Props) {
  const toast = useToast();
  const { data, isLoading, isError, error } = useAvailableTeamRepos(
    installationId,
    slug,
  );
  const setRepoPermissionMutation = useSetTeamRepoPermission(
    installationId,
    slug,
  );

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [permission, setPermission] = useState<GitHubRepoPermission>("push");
  const [formError, setFormError] = useState<string | null>(null);

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

  const existing = useMemo(
    () => new Set(existingFullNames.map((name) => name.toLowerCase())),
    [existingFullNames],
  );

  const available = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (repo) =>
        !existing.has(repo.fullName.toLowerCase()) &&
        (!term || repo.fullName.toLowerCase().includes(term)),
    );
  }, [data, existing, search]);

  const handleSubmit = async () => {
    setFormError(null);
    if (!canManage) {
      setFormError(
        "La permission GitHub App « Administration: write » est requise pour modifier les dépôts d'une équipe.",
      );
      return;
    }
    if (!selected) {
      setFormError("Sélectionnez un dépôt à associer.");
      return;
    }
    const [owner, repo] = selected.split("/");
    if (!owner || !repo) {
      setFormError("Nom de dépôt invalide.");
      return;
    }

    try {
      const result = await setRepoPermissionMutation.mutateAsync({
        owner,
        repo,
        permission,
      });
      const message = `Dépôt ${result.repository} associé à l'équipe avec la permission « ${result.permission} »`;
      toast.show("success", message);
      onAdded(message);
    } catch (err) {
      setFormError(getErrorMessage(err));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-repo-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="add-repo-title" className="text-lg font-semibold">
              Associer un dépôt
            </h2>
            <p className="text-xs text-muted">
              Équipe <span className="font-medium">{teamName}</span> · l'opération
              modifie réellement l'accès sur GitHub.
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
          {!canManage && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
              Permission « Administration: write » manquante : GitHub refusera la
              modification. Mettez à jour la GitHub App et l'installation.
            </div>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un dépôt de l'organisation…"
              className="pl-8"
            />
          </div>

          <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {isLoading && (
              <p className="p-2 text-xs text-muted">Chargement des dépôts…</p>
            )}
            {isError && (
              <p className="p-2 text-xs text-red-500">
                {error instanceof Error ? error.message : "Erreur de chargement"}
              </p>
            )}
            {!isLoading && !isError && available.length === 0 && (
              <p className="p-2 text-xs text-muted">
                Aucun dépôt disponible. Tous les dépôts accessibles sont déjà
                associés, ou l'installation n'a accès à aucun dépôt de cette
                organisation.
              </p>
            )}
            {available.map((repo) => (
              <label
                key={repo.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm",
                  selected === repo.fullName
                    ? "bg-primary-600/10"
                    : "hover:bg-slate-100 dark:hover:bg-slate-700/50",
                )}
              >
                <input
                  type="radio"
                  name="team-repo"
                  checked={selected === repo.fullName}
                  onChange={() => setSelected(repo.fullName)}
                  className="h-4 w-4 border-border text-primary-600 focus:ring-primary-500"
                />
                <Github className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="truncate font-mono text-xs">{repo.fullName}</span>
                {repo.private && (
                  <Lock className="ml-auto h-3 w-3 shrink-0 text-amber-500" />
                )}
              </label>
            ))}
          </div>

          <div>
            <label htmlFor="repo-permission" className="mb-1.5 block text-sm font-medium">
              Permission GitHub sur le dépôt *
            </label>
            <Select
              id="repo-permission"
              value={permission}
              onChange={(e) => setPermission(e.target.value as GitHubRepoPermission)}
            >
              {PERMISSIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted">
              Cette permission GitHub est distincte des rôles internes du projet
              DevSecOps.
            </p>
          </div>

          {selected && (
            <SimpleBadge className="font-mono">{selected}</SimpleBadge>
          )}

          {formError && (
            <div
              role="alert"
              className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-500"
            >
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button
              onClick={handleSubmit}
              loading={setRepoPermissionMutation.isPending}
              disabled={!selected || !canManage}
              className="gap-2"
            >
              <Github className="h-4 w-4" /> Associer sur GitHub
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
