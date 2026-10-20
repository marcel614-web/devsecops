// apps/web/src/features/servers/EditServerModal.tsx
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useUpdateServer } from "@/hooks/useServers";
import { getErrorMessage } from "@/services/api";
import type { UpdateServerInput } from "@/services/server.service";
import type { DeploymentServer } from "@/types/api";

const schema = z
  .object({
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
    // Vide = conserver la clé actuelle.
    privateKey: z.string().optional(),
    passphrase: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    const key = values.privateKey?.trim();
    if (!key) return;
    if (key.length < 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["privateKey"],
        message: "Clé privée trop courte",
      });
    }
    if (!key.includes("-----BEGIN") || !key.includes("PRIVATE KEY-----")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["privateKey"],
        message: "Format PEM attendu (-----BEGIN ... PRIVATE KEY-----)",
      });
    }
  });

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  server: DeploymentServer | null;
  onClose: () => void;
  onUpdated: (
    server: DeploymentServer,
    name: string,
    connectionChanged: boolean,
  ) => void;
}

export function EditServerModal({ open, server, onClose, onUpdated }: Props) {
  const [serverError, setServerError] = useState<string | null>(null);
  const updateMutation = useUpdateServer();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      host: "",
      sshPort: 22,
      username: "deploy",
      privateKey: "",
      passphrase: "",
    },
  });

  useEffect(() => {
    if (!open || !server) return;
    reset({
      name: server.name,
      host: server.host,
      sshPort: server.sshPort,
      username: server.username,
      privateKey: "",
      passphrase: "",
    });
    setServerError(null);
  }, [open, server, reset]);

  if (!open || !server) return null;

  const onSubmit = async (values: FormValues) => {
    setServerError(null);

    const payload: UpdateServerInput = {};
    if (values.name !== server.name) payload.name = values.name;
    if (values.host !== server.host) payload.host = values.host;
    if (values.sshPort !== server.sshPort) payload.sshPort = values.sshPort;
    if (values.username !== server.username) {
      payload.username = values.username;
    }

    const privateKey = values.privateKey?.trim();
    if (privateKey) payload.privateKey = privateKey;

    const passphrase = values.passphrase?.trim();
    if (passphrase) payload.passphrase = passphrase;

    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    const connectionChanged =
      payload.host !== undefined ||
      payload.sshPort !== undefined ||
      payload.username !== undefined ||
      payload.privateKey !== undefined;

    try {
      await updateMutation.mutateAsync({ id: server.id, data: payload });
      onUpdated(server, values.name, connectionChanged);
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
          <h2 className="font-semibold text-lg">Modifier le serveur</h2>
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
            <Input placeholder="192.168.1.59" {...register("host")} />
            {errors.host && (
              <p className="text-xs text-red-500 mt-1">{errors.host.message}</p>
            )}
            <p className="text-xs text-muted mt-1">
              C'est cette adresse qui est utilisée pour le SSH et les
              déploiements.
            </p>
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
            <div className="px-3 py-2 rounded-md border border-border bg-background text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              Clé SSH
              {server.hasPrivateKey && (
                <span className="text-xs text-muted">
                  (clé déjà enregistrée)
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">
              Nouvelle clé privée SSH (PEM)
            </label>
            <textarea
              rows={4}
              placeholder="Laisser vide pour conserver la clé actuelle"
              className="w-full px-3 py-2 rounded-md bg-slate-900 border border-border text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-xs"
              {...register("privateKey")}
            />
            {errors.privateKey && (
              <p className="text-xs text-red-500 mt-1">
                {errors.privateKey.message}
              </p>
            )}
            <p className="text-xs text-muted mt-1">
              La clé est chiffrée en base et n'est jamais renvoyée au client.
            </p>
          </div>

          <div>
            <label className="block text-sm mb-1">
              Passphrase de la clé (si chiffrée)
            </label>
            <Input
              type="password"
              placeholder="Laisser vide pour conserver l'actuelle"
              {...register("passphrase")}
            />
            {errors.passphrase && (
              <p className="text-xs text-red-500 mt-1">
                {errors.passphrase.message}
              </p>
            )}
          </div>

          <div className="text-xs text-muted bg-primary-500/10 border border-primary-500/30 rounded p-2">
            Modifier l'hôte, le port, l'utilisateur ou la clé réinitialise le
            statut de connexion. Un test SSH sera relancé automatiquement après
            l'enregistrement.
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
              Enregistrer
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
