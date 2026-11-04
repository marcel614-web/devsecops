// apps/web/src/features/organizations/CreateTeamModal.tsx
import { useEffect, useMemo, useState } from "react";
import { X, Users, Github, Lock, Globe, Bell } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SimpleBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/feedback/Toast";
import {
  useCreateTeam,
  useGithubRepositories,
  useGithubTeams,
} from "@/hooks/useGithub";
import { getErrorMessage } from "@/services/api";
import { cn } from "@/lib/utils";
import type {
  CreateGitHubTeamInput,
  GitHubTeam,
  GitHubTeamPrivacy,
} from "@/services/github.service";

const USERNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

function parseUsernames(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

interface Props {
  installationId: string;
  organizationLogin: string;
  onClose: () => void;
  onCreated: (team: GitHubTeam) => void;
}

export function CreateTeamModal({
  installationId,
  organizationLogin,
  onClose,
  onCreated,
}: Props) {
  const toast = useToast();
  const createMutation = useCreateTeam(installationId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<GitHubTeamPrivacy>("closed");
  const [parentTeamId, setParentTeamId] = useState("");
  const [maintainers, setMaintainers] = useState("");
  const [notificationSetting, setNotificationSetting] = useState<
    "notifications_enabled" | "notifications_disabled"
  >("notifications_enabled");
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: teamsData, isLoading: teamsLoading } = useGithubTeams(
    installationId,
    { pageSize: 100 },
  );
  const { data: reposData, isLoading: reposLoading } = useGithubRepositories(
    { pageSize: 100 },
    true,
  );

  const orgRepos = useMemo(
    () =>
      (reposData?.items ?? []).filter(
        (repo) =>
          repo.installation.accountLogin.toLowerCase() ===
          organizationLogin.toLowerCase(),
      ),
    [reposData, organizationLogin],
  );

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

  const toggleRepo = (fullName: string) => {
    setSelectedRepos((current) =>
      current.includes(fullName)
        ? current.filter((item) => item !== fullName)
        : [...current, fullName],
    );
  };

  const handleSubmit = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Le nom de l'équipe est obligatoire.");
      return;
    }
    if (trimmedName.length > 100) {
      setError("Le nom de l'équipe ne peut pas dépasser 100 caractères.");
      return;
    }
    if (description.trim().length > 255) {
      setError("La description ne peut pas dépasser 255 caractères.");
      return;
    }
    const maintainerList = parseUsernames(maintainers);
    const invalidMaintainers = maintainerList.filter(
      (username) => !USERNAME_REGEX.test(username),
    );
    if (invalidMaintainers.length > 0) {
      setError(
        `Nom(s) d'utilisateur GitHub invalide(s) : ${invalidMaintainers.join(", ")}.`,
      );
      return;
    }

    const payload: CreateGitHubTeamInput = {
      name: trimmedName,
      description: description.trim() || undefined,
      privacy,
      parentTeamId: parentTeamId || undefined,
      maintainers: maintainerList.length > 0 ? maintainerList : undefined,
      repoFullNames: selectedRepos.length > 0 ? selectedRepos : undefined,
      notificationSetting,
    };

    try {
      const result = await createMutation.mutateAsync(payload);
      toast.show("success", `Équipe « ${result.team.name} » créée sur GitHub`);
      onCreated(result.team);
    } catch (err) {
      setError(getErrorMessage(err));
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
        aria-labelledby="create-team-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="create-team-title" className="text-lg font-semibold">
              Créer une équipe GitHub
            </h2>
            <p className="text-xs text-muted">
              L'équipe sera réellement créée dans l'organisation{" "}
              <span className="font-medium">{organizationLogin}</span>.
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
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="team-name" className="mb-1.5 block text-sm font-medium">
                Nom de l'équipe *
              </label>
              <Input
                id="team-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder="Équipe Sécurité"
              />
            </div>
            <div>
              <label htmlFor="team-privacy" className="mb-1.5 block text-sm font-medium">
                Visibilité *
              </label>
              <Select
                id="team-privacy"
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as GitHubTeamPrivacy)}
              >
                <option value="closed">Closed — visible par les membres de l'organisation</option>
                <option value="secret">Secret — visible uniquement par les membres de l'équipe</option>
              </Select>
            </div>
          </div>

          <div>
            <label htmlFor="team-description" className="mb-1.5 block text-sm font-medium">
              Description
            </label>
            <textarea
              id="team-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={255}
              placeholder="Rôle de l'équipe (facultatif)"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-slate-100"
            />
          </div>

          {/* PARENT_AND_MAINTAINERS */}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="team-parent" className="mb-1.5 block text-sm font-medium">
                Équipe parente
              </label>
              <Select
                id="team-parent"
                value={parentTeamId}
                onChange={(e) => setParentTeamId(e.target.value)}
                disabled={teamsLoading}
              >
                <option value="">Aucune (équipe racine)</option>
                {(teamsData?.items ?? []).map((team) => (
                  <option key={team.id} value={team.githubTeamId}>
                    {team.name} ({team.slug})
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted">
                L'équipe parente doit appartenir à la même organisation.
              </p>
            </div>
            <div>
              <label htmlFor="team-notifications" className="mb-1.5 block text-sm font-medium">
                Notifications
              </label>
              <Select
                id="team-notifications"
                value={notificationSetting}
                onChange={(e) =>
                  setNotificationSetting(
                    e.target.value as
                      | "notifications_enabled"
                      | "notifications_disabled",
                  )
                }
              >
                <option value="notifications_enabled">Notifications activées</option>
                <option value="notifications_disabled">Notifications désactivées</option>
              </Select>
            </div>
          </div>

          <div>
            <label htmlFor="team-maintainers" className="mb-1.5 block text-sm font-medium">
              Mainteneurs initiaux
            </label>
            <Input
              id="team-maintainers"
              value={maintainers}
              onChange={(e) => setMaintainers(e.target.value)}
              placeholder="alice, bob"
            />
            <p className="mt-1 text-xs text-muted">
              Logins GitHub séparés par des virgules. GitHub peut transformer
              l'ajout en invitation en attente selon l'organisation.
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium">
                Dépôts à associer <span className="text-muted">(facultatif)</span>
              </label>
              <SimpleBadge>
                {selectedRepos.length} sélectionné(s)
              </SimpleBadge>
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {reposLoading && (
                <p className="p-2 text-xs text-muted">Chargement des dépôts…</p>
              )}
              {!reposLoading && orgRepos.length === 0 && (
                <p className="p-2 text-xs text-muted">
                  Aucun dépôt accessible pour cette organisation. Synchronisez
                  l'installation depuis la page Repositories.
                </p>
              )}
              {orgRepos.map((repo) => (
                <label
                  key={repo.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm",
                    selectedRepos.includes(repo.fullName)
                      ? "bg-primary-600/10"
                      : "hover:bg-slate-100 dark:hover:bg-slate-700/50",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedRepos.includes(repo.fullName)}
                    onChange={() => toggleRepo(repo.fullName)}
                    className="h-4 w-4 rounded border-border text-primary-600 focus:ring-primary-500"
                  />
                  <Github className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className="truncate font-mono text-xs">{repo.fullName}</span>
                  {repo.private && (
                    <Lock className="ml-auto h-3 w-3 shrink-0 text-amber-500" />
                  )}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">
              La permission accordée sera celle par défaut de GitHub. Elle pourra
              être modifiée dans l'onglet « Dépôts associés ».
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-500"
            >
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <Users className="h-3.5 w-3.5" />
              La création nécessite la permission GitHub App « Members: write ».
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Annuler
              </Button>
              <Button
                onClick={handleSubmit}
                loading={createMutation.isPending}
                disabled={!name.trim()}
                className="gap-2"
              >
                <Users className="h-4 w-4" /> Créer sur GitHub
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
