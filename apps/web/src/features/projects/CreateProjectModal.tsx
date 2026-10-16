import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, Github, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useCreateProject } from "@/hooks/useProjects";
import { useGithubBranches, useGithubInstallations, useGithubRepositories } from "@/hooks/useGithub";
import { getErrorMessage } from "@/services/api";
import { cn } from "@/lib/utils";

const schema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  repoFullName: z.string().trim().min(3, "Dépôt requis"),
  repoId: z.string().trim().min(1, "ID requis"),
  defaultBranch: z.string().trim().min(1, "Branche requise").max(120),
  technology: z.enum(["NODEJS", "PHP", "PYTHON", "UNKNOWN"]),
});
type FormValues = z.infer<typeof schema>;

const TECHS = [
  { v: "NODEJS", l: "Node.js" },
  { v: "PHP", l: "PHP" },
  { v: "PYTHON", l: "Python" },
  { v: "UNKNOWN", l: "Autre" },
] as const;

interface Props { open: boolean; onClose: () => void; onCreated: (name: string) => void }

const Err = ({ m }: { m?: string }) => (m ? <p role="alert" className="mt-1 text-xs text-red-500">{m}</p> : null);
const Label = ({ children }: { children: React.ReactNode }) => <label className="mb-1.5 block text-sm font-medium">{children}</label>;

export function CreateProjectModal({ open, onClose, onCreated }: Props) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [useGithubPicker, setUseGithubPicker] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);

  const createMutation = useCreateProject();
  const { data: installations } = useGithubInstallations();
  const hasGithub = (installations ?? []).length > 0;
  const connectedInstall = installations?.[0] ?? null;

  const { data: ghRepos, isLoading: reposLoading } = useGithubRepositories({}, open && useGithubPicker && hasGithub);
  const { data: branches, isLoading: branchesLoading } = useGithubBranches(selectedRepoId);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { defaultBranch: "main", technology: "NODEJS" },
  });
  const tech = watch("technology");

  useEffect(() => {
    if (!open) {
      reset();
      setSelectedRepo(null); setSelectedRepoId(null); setServerError(null);
      setUseGithubPicker(false); setRepoDropdownOpen(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose, reset]);

  if (!open) return null;

  const handleSelectRepo = (fullName: string, repoId: string, defaultBranch: string) => {
    setSelectedRepo(fullName); setSelectedRepoId(repoId);
    setValue("repoFullName", fullName, { shouldValidate: true });
    setValue("repoId", repoId, { shouldValidate: true });
    setValue("defaultBranch", defaultBranch, { shouldValidate: true });
    setRepoDropdownOpen(false);
  };

  const onSubmit = async (v: FormValues) => {
    setServerError(null);
    try {
      await createMutation.mutateAsync({ ...v, description: v.description || null });
      onCreated(v.name);
    } catch (err) {
      setServerError(getErrorMessage(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="create-project-title"
        className="scrollbar-thin max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <div>
            <h2 id="create-project-title" className="text-lg font-semibold">Nouveau projet</h2>
            <p className="text-xs text-muted">Associez un dépôt pour lancer des pipelines.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-md p-1.5 text-muted hover:bg-slate-100 dark:hover:bg-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 p-6" noValidate>
          <div>
            <Label>Nom du projet *</Label>
            <Input autoFocus placeholder="Mon application" {...register("name")} />
            <Err m={errors.name?.message} />
          </div>
          <div>
            <Label>Description</Label>
            <Input placeholder="Optionnel" {...register("description")} />
          </div>

          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Dépôt</span>
              {hasGithub && (
                <button
                  type="button"
                  onClick={() => setUseGithubPicker((v) => !v)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                    useGithubPicker ? "border-primary-500 bg-primary-600/10 text-primary-600 dark:text-primary-400" : "border-border hover:bg-slate-100 dark:hover:bg-slate-700",
                  )}
                >
                  <Github className="h-3.5 w-3.5" />
                  {useGithubPicker ? `GitHub · ${connectedInstall?.accountLogin}` : "Choisir depuis GitHub"}
                </button>
              )}
            </div>

            {useGithubPicker && hasGithub ? (
              <>
                <div className="relative">
                  <button
                    type="button"
                    aria-haspopup="listbox" aria-expanded={repoDropdownOpen}
                    onClick={() => setRepoDropdownOpen((v) => !v)}
                    className="flex w-full items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <span className={cn("truncate", !selectedRepo && "text-muted")}>{selectedRepo ?? "Choisir un dépôt…"}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
                  </button>
                  {repoDropdownOpen && (
                    <div role="listbox" className="scrollbar-thin absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
                      {reposLoading && <p className="p-3 text-xs text-muted">Chargement…</p>}
                      {ghRepos?.items.map((r) => (
                        <button key={r.id} type="button" role="option" aria-selected={r.fullName === selectedRepo}
                          onClick={() => handleSelectRepo(r.fullName, r.id, r.defaultBranch)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700">
                          <span className="w-4 shrink-0">{r.fullName === selectedRepo && <Check className="h-3.5 w-3.5 text-primary-500" />}</span>
                          <span className="flex-1 truncate">{r.fullName}</span>
                          <span className="text-[10px] text-muted">{r.private ? "Privé" : "Public"}</span>
                        </button>
                      ))}
                      {!reposLoading && ghRepos?.items.length === 0 && <p className="p-3 text-xs text-muted">Aucun dépôt accessible</p>}
                    </div>
                  )}
                </div>
                <input type="hidden" {...register("repoFullName")} />
                <input type="hidden" {...register("repoId")} />
                <Err m={errors.repoFullName?.message} />
                <div>
                  <Label>Branche</Label>
                  <Select {...register("defaultBranch")} disabled={!selectedRepo || branchesLoading}>
                    {!selectedRepo && <option value="">Choisissez d'abord un dépôt</option>}
                    {branchesLoading && <option value="">Chargement…</option>}
                    {branches?.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
                  </Select>
                  <Err m={errors.defaultBranch?.message} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label>Dépôt (propriétaire/nom) *</Label>
                  <Input placeholder="octocat/Hello-World" {...register("repoFullName")} />
                  <Err m={errors.repoFullName?.message} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>ID du dépôt *</Label>
                    <Input inputMode="numeric" placeholder="123456789" {...register("repoId")} />
                    <Err m={errors.repoId?.message} />
                  </div>
                  <div>
                    <Label>Branche par défaut</Label>
                    <Input {...register("defaultBranch")} />
                    <Err m={errors.defaultBranch?.message} />
                  </div>
                </div>
              </>
            )}
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Technologie</legend>
            <div className="grid grid-cols-4 gap-2">
              {TECHS.map((t) => (
                <label key={t.v} className={cn(
                  "cursor-pointer rounded-md border px-2 py-2 text-center text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500",
                  tech === t.v ? "border-primary-500 bg-primary-600/10 font-medium text-primary-600 dark:text-primary-400" : "border-border hover:bg-slate-100 dark:hover:bg-slate-700",
                )}>
                  <input type="radio" value={t.v} className="sr-only" {...register("technology")} />
                  {t.l}
                </label>
              ))}
            </div>
          </fieldset>

          {serverError && (
            <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-500">{serverError}</div>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={isSubmitting}>Créer le projet</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
