// apps/web/src/features/servers/CreateServerModal.tsx
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useCreateServer } from "@/hooks/useServers";
import { getErrorMessage } from "@/services/api";

const schema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(80),
  host: z
    .string()
    .trim()
    .min(1, "Hôte requis")
    .regex(
      /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/,
      "IP ou hostname attendu",
    ),
  sshPort: z
    .number()
    .int("Port entier requis")
    .min(1, "Min 1")
    .max(65535, "Max 65535"),
  username: z
    .string()
    .trim()
    .min(1, "Utilisateur requis")
    .regex(/^[a-z_][a-z0-9_-]*$/, "Format : a-z, _, -"),
  authType: z.literal("SSH_KEY"),
  privateKey: z
    .string()
    .min(100, "Clé privée trop courte")
    .refine(
      (v) => v.includes("-----BEGIN") && v.includes("PRIVATE KEY-----"),
      "Format PEM attendu (-----BEGIN ... PRIVATE KEY-----)",
    ),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}

export function CreateServerModal({ open, onClose, onCreated }: Props) {
  const [serverError, setServerError] = useState<string | null>(null);
  const createMutation = useCreateServer();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sshPort: 22,
      username: "deploy",
      authType: "SSH_KEY",
    },
  });

  if (!open) return null;

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      await createMutation.mutateAsync(values);
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
          <h2 className="font-semibold text-lg">Nouveau serveur</h2>
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
            <label className="block text-sm mb-1">Nom du serveur *</label>
            <Input autoFocus placeholder="Ubuntu-Test" {...register("name")} />
            {errors.name && (
              <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm mb-1">
              Hôte (IP ou hostname) *
            </label>
            <Input placeholder="192.168.56.20" {...register("host")} />
            {errors.host && (
              <p className="text-xs text-red-500 mt-1">{errors.host.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Port SSH</label>
              <Input
                type="number"
                {...register("sshPort", { valueAsNumber: true })}
              />
              {errors.sshPort && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.sshPort.message}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm mb-1">Utilisateur SSH</label>
              <Input placeholder="deploy" {...register("username")} />
              {errors.username && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.username.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">
              Méthode d'authentification
            </label>
            <Select {...register("authType")} disabled>
              <option value="SSH_KEY">Clé SSH</option>
            </Select>
            <p className="text-xs text-muted mt-1">
              L'authentification par mot de passe n'est pas supportée.
            </p>
          </div>

          <div>
            <label className="block text-sm mb-1">
              Clé privée SSH (PEM) *
            </label>
            <textarea
              rows={6}
              placeholder={
                "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"
              }
              className="w-full px-3 py-2 rounded-md bg-slate-900 border border-border text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-xs"
              {...register("privateKey")}
            />
            {errors.privateKey && (
              <p className="text-xs text-red-500 mt-1">
                {errors.privateKey.message}
              </p>
            )}
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