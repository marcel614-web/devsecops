// apps/web/src/features/organizations/TeamProjectAssociationModal.tsx
import { useEffect, useMemo, useState } from "react";
import { X, FolderGit2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/feedback/Toast";
import { useAssociateTeamProject } from "@/hooks/useGithub";
import { useProjects } from "@/hooks/useProjects";
import { getErrorMessage } from "@/services/api";
import type { ProjectTeamRole } from "@/services/github.service";

const ROLES: Array<{ value: ProjectTeamRole; label: string }> = [
  { value: "OWNER", label: "OWNER — propriétaire du projet" },
  { value: "MAINTAINER", label: "MAINTAINER — maintenance" },
  { value: "DEVELOPER", label: "DEVELOPER — développement" },
  { value: "SECURITY_ANALYST", label: "SECURITY_ANALYST — sécurité" },
  { value: "VIEWER", label: "VIEWER — lecture seule" },
];

interface Props {
  installationId: string;
  slug: string;
  teamName: string;
  existingProjectIds: string[];
  onClose: () => void;
  onAdded: (message: string) => void;
}

export function TeamProjectAssociationModal({
  installationId,
  slug,
  teamName,
  existingProjectIds,
  onClose,
  onAdded,
}: Props) {
  const toast = useToast();
  const { data: projects, isLoading } = useProjects({ pageSize: 100 });
  const associate = useAssociateTeamProject(installationId, slug);

  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState<ProjectTeamRole>("VIEWER");
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

  const existing = useMemo(
    () => new Set(existingProjectIds),
    [existingProjectIds],
  );
  const available = (projects?.items ?? []).filter(
    (project) => !existing.has(project.id),
  );

  const handleSubmit = async () => {
    setError(null);
    if (!projectId) {
      setError("Sélectionnez un projet DevSecOps.");
      return;
    }
    try {
      await associate.mutateAsync({ projectId, role });
      const project = projects?.items.find((item) => item.id === projectId);
      const message = `Équipe « ${teamName} » associée au projet « ${
        project?.name ?? projectId
      } » avec le rôle interne ${role}`;
      toast.show("success", message);
      onAdded(message);
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
        aria-labelledby="team-project-title"
        className="w-full max-w-md rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="team-project-title" className="text-lg font-semibold">
              Associer à un projet
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
            <label htmlFor="team-project" className="mb-1.5 block text-sm font-medium">
              Projet DevSecOps *
            </label>
            <Select
              id="team-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={isLoading}
            >
              <option value="">
                {isLoading ? "Chargement…" : "Choisir un projet"}
              </option>
              {available.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.repoFullName})
                </option>
              ))}
            </Select>
            {!isLoading && available.length === 0 && (
              <p className="mt-1 text-xs text-muted">
                Tous les projets accessibles sont déjà associés, ou aucun projet
                n'est disponible.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="team-project-role" className="mb-1.5 block text-sm font-medium">
              Rôle interne au projet *
            </label>
            <Select
              id="team-project-role"
              value={role}
              onChange={(e) => setRole(e.target.value as ProjectTeamRole)}
            >
              {ROLES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 text-xs text-muted">
            <FolderGit2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Ce rôle est appliqué uniquement par l'API DevSecOps Manager. Il ne
              modifie jamais les permissions GitHub et un changement de rôle GitHub
              n'augmente pas automatiquement les droits internes.
            </span>
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
              loading={associate.isPending}
              disabled={!projectId}
              className="gap-2"
            >
              <Link2 className="h-4 w-4" /> Associer
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
