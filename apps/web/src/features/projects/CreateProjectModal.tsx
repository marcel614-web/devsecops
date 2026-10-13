// apps/web/src/features/projects/CreateProjectModal.tsx
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useCreateProject } from "@/hooks/useProjects";
import { getErrorMessage } from "@/services/api";

const schema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  repoFullName: z
    .string()
    .trim()
    .min(3)
    .regex(
      /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|local:.+)$/,
      "Format attendu : owner/repo ou local:chemin",
    ),
  repoId: z.string().trim().min(1, "Requis"),
  defaultBranch: z.string().trim().min(1).max(120),
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
  const createMutation = useCreateProject();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      defaultBranch: "main",
      technology: "NODEJS",
    },
  });

  if (!open) return null;

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
          <button onClick={onClose} className="text-muted hover:text-slate-700 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4" noValidate>
          <div>
            <label className="block text-sm mb-1">Nom du projet *</label>
            <Input autoFocus {...register("name")} />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="block text-sm mb-1">Description</label>
            <Input {...register("description")} />
          </div>

          <div>
            <label className="block text-sm mb-1">Repository *</label>
            <Input placeholder="owner/repo ou local:chemin" {...register("repoFullName")} />
            {errors.repoFullName && (
              <p className="text-xs text-red-500 mt-1">{errors.repoFullName.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm mb-1">Repo ID *</label>
            <Input {...register("repoId")} />
            {errors.repoId && <p className="text-xs text-red-500 mt-1">{errors.repoId.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Branche par défaut</label>
              <Input {...register("defaultBranch")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Technologie</label>
              <Select {...register("technology")}>
                <option value="NODEJS">Node.js</option>
                <option value="PHP">PHP</option>
                <option value="PYTHON">Python</option>
                <option value="UNKNOWN">Inconnu</option>
              </Select>
            </div>
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