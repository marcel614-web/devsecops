// apps/web/src/features/organizations/AddTeamMemberModal.tsx
import { useEffect, useState } from "react";
import { X, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/feedback/Toast";
import { useAddTeamMember } from "@/hooks/useGithub";
import { getErrorMessage } from "@/services/api";
import type { GitHubTeamMemberRole } from "@/services/github.service";

const USERNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

interface Props {
  installationId: string;
  slug: string;
  teamName: string;
  onClose: () => void;
  onAdded: (message: string) => void;
}

export function AddTeamMemberModal({
  installationId,
  slug,
  teamName,
  onClose,
  onAdded,
}: Props) {
  const toast = useToast();
  const addMutation = useAddTeamMember(installationId, slug);

  const [username, setUsername] = useState("");
  const [role, setRole] = useState<GitHubTeamMemberRole>("member");
  const [error, setError] = useState<string | null>(null);

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

  const handleSubmit = async () => {
    setError(null);
    const trimmed = username.trim();
    if (!trimmed) {
      setError("Le nom d'utilisateur GitHub est obligatoire.");
      return;
    }
    if (!USERNAME_REGEX.test(trimmed)) {
      setError("Nom d'utilisateur GitHub invalide.");
      return;
    }

    try {
      const result = await addMutation.mutateAsync({
        username: trimmed,
        role,
      });
      toast.show(result.state === "pending" ? "info" : "success", result.message);
      onAdded(result.message);
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
        aria-labelledby="add-member-title"
        className="w-full max-w-md rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="add-member-title" className="text-lg font-semibold">
              Ajouter un membre
            </h2>
            <p className="text-xs text-muted">
              Équipe <span className="font-medium">{teamName}</span>
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
          <div>
            <label htmlFor="member-username" className="mb-1.5 block text-sm font-medium">
              Utilisateur GitHub *
            </label>
            <Input
              id="member-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="octocat"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-muted">
              GitHub peut créer une invitation en attente si la personne n'est
              pas encore membre de l'organisation.
            </p>
          </div>

          <div>
            <label htmlFor="member-role" className="mb-1.5 block text-sm font-medium">
              Rôle dans l'équipe GitHub *
            </label>
            <Select
              id="member-role"
              value={role}
              onChange={(e) => setRole(e.target.value as GitHubTeamMemberRole)}
            >
              <option value="member">Member</option>
              <option value="maintainer">Maintainer</option>
            </Select>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-500"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button
              onClick={handleSubmit}
              loading={addMutation.isPending}
              disabled={!username.trim()}
              className="gap-2"
            >
              <UserPlus className="h-4 w-4" /> Ajouter sur GitHub
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
