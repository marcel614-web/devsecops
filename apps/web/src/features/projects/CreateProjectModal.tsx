// apps/web/src/features/projects/CreateProjectModal.tsx
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, Github, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useCreateProject } from "@/hooks/useProjects";
import {
  useGithubBranches,
  useGithubRepos,
  useGithubStatus,
} from "@/hooks/useGithub";
import { getErrorMessage } from "@/services/api";
import { cn } from "@/lib/utils";

const schema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  repoFullName: z.string().trim().min(3, "Repository requis"),
  repoId: z.string().trim().min(1, "Requis"),
  defaultBranch: z.string().trim().min(1, "Branche requise").max(120),
  technology: z.enum(["NODEJS", "PHP", "PYTHON", "UNKNOWN"]),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}

export function CreateProjectModal({ open, onClose, onCreated }: Props) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [useGithubPicker, setUseGithubPicker] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);

  const createMutation = useCreateProject();
  const { data: ghStatus } = useGithubStatus();
  const { data: ghRepos, isLoading: reposLoading } = useGithubRepos(
    open && useGithubPicker && !!ghStatus?.connected,
  );

  const [owner, repo] = selectedRepo
    ? selectedRepo.split("/")
    : [null, null];

  const { data: branches, isLoading: branchesLoading } = useGithubBranches(
    owner,
    repo,
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      defaultBranch: "main",
      technology: "NODEJS",
    },
  });

  const currentRepo = watch("repoFullName");

  // Reset le formulaire quand on ferme
  useEffect(() => {
    if (!open) {
      setSelectedRepo(null);
      setServerError(null);
      setUseGithubPicker(false);
      setRepoDropdownOpen(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSelectRepo = (fullName: string, repoId: number, defaultBranch: string) => {
    setSelectedRepo(fullName);
    setValue("repoFullName", fullName, { shouldValidate: true });
    setValue("repoId", String(repoId), { shouldValidate: true });
    setValue("defaultBranch", defaultBranch, { shouldValidate: true });
    setRepoDropdownOpen(false);
  };

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      await createMutation.mutateAsync({
        name: values.name,
        description: values.description || null,
        repoFullName: values.repoFullName,
        repoId: values.repoId,
        defaultBranch: values.defaultBranch,
        technology: values.technology,
      });
      onCreated(values.name);
      reset();
      setSelectedRepo(null);
    } catch (err) {
      setServerError(getErrorMessage(err));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-lg">Nouveau projet</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="p-6 space-y-4"
          noValidate
        >
          <div>
            <label className="block text-sm mb-1">Nom du projet *</label>
            <Input autoFocus {...register("name")} />
            {errors.name && (
              <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm mb-1">Description</label>
            <Input {...register("description")} />
          </div>

          {/* --------------------------------------------------
              Sélecteur GitHub
          -------------------------------------------------- */}
          {ghStatus?.connected && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setUseGithubPicker((v) => !v)}
                className={cn(
                  "flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border transition-colors",
                  useGithubPicker
                    ? "border-primary-500 bg-primary-600/10 text-primary-600 dark:text-primary-500"
                    : "border-border hover:bg-slate-100 dark:hover:bg-slate-700",
                )}
              >
                <Github className="w-3.5 h-3.5" />
                {useGithubPicker
                  ? "Sélection GitHub activée"
                  : "Sélectionner depuis GitHub"}
              </button>
              <span className="text-xs text-muted">
                (connecté : {ghStatus.login})
              </span>
            </div>
          )}

          {useGithubPicker && ghStatus?.connected ? (
            <div className="space-y-3">
              {/* Sélecteur de repo */}
              <div>
                <label className="block text-sm mb-1">
                  Repository *
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setRepoDropdownOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-surface border border-border text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <span className={selectedRepo ? "" : "text-muted"}>
                      {selectedRepo ?? "Choisir un repository…"}
                    </span>
                    <ChevronDown className="w-4 h-4 text-muted shrink-0" />
                  </button>

                  {repoDropdownOpen && (
                    <div className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto scrollbar-thin bg-surface border border-border rounded-md shadow-lg">
                      {reposLoading && (
                        <p className="p-3 text-xs text-muted">Chargement…</p>
                      )}
                      {ghRepos?.repositories.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() =>
                            handleSelectRepo(
                              r.full_name,
                              r.id,
                              r.default_branch,
                            )
                          }
                          className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          {r.full_name === selectedRepo && (
                            <Check className="w-3.5 h-3.5 text-primary-500 shrink-0" />
                          )}
                          <span className="flex-1 truncate">{r.full_name}</span>
                          <span className="text-[10px] text-muted">
                            {r.private ? "🔒" : "🌐"}
                          </span>
                        </button>
                      ))}
                      {!reposLoading &&
                        ghRepos?.repositories.length === 0 && (
                          <p className="p-3 text-xs text-muted">
                            Aucun repository
                          </p>
                        )}
                    </div>
                  )}
                </div>
                <input type="hidden" {...register("repoFullName")} />
                <input type="hidden" {...register("repoId")} />
                {errors.repoFullName && (
                  <p className="text-xs text-red-500 mt-1">
                    {errors.repoFullName.message}
                  </p>
                )}
              </div>

              {/* Sélecteur de branche */}
              <div>
                <label className="block text-sm mb-1">Branche *</label>
                <Select
                  {...register("defaultBranch")}
                  disabled={!selectedRepo || branchesLoading}
                >
                  {!selectedRepo && <option value="">— Choisir un repo —</option>}
                  {branchesLoading && <option value="">Chargement…</option>}
                  {branches?.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </Select>
                {errors.defaultBranch && (
                  <p className="text-xs text-red-500 mt-1">
                    {errors.defaultBranch.message}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm mb-1">
                  Repository (owner/repo) *
                </label>
                <Input
                  placeholder="octocat/Hello-World"
                  {...register("repoFullName")}
                />
                {errors.repoFullName && (
                  <p className="text-xs text-red-500 mt-1">
                    {errors.repoFullName.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm mb-1">Repo ID *</label>
                <Input {...register("repoId")} />
                {errors.repoId && (
                  <p className="text-xs text-red-500 mt-1">
                    {errors.repoId.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm mb-1">Branche par défaut</label>
                <Input {...register("defaultBranch")} />
              </div>
            </div>
          )}

          {/* Technologie */}
          <div>
            <label className="block text-sm mb-1">Technologie</label>
            <Select {...register("technology")}>
              <option value="NODEJS">Node.js</option>
              <option value="PHP">PHP</option>
              <option value="PYTHON">Python</option>
              <option value="UNKNOWN">Inconnu</option>
            </Select>
          </div>

          {serverError && (
            <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2">
              {serverError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Créer
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}