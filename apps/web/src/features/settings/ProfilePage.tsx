import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Save,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { UserRoleBadge, UserStatusBadge, initials } from "@/components/ui/UserBadge";
import { useToast } from "@/components/feedback/Toast";
import { SettingsPageHeader } from "./SettingsPageHeader";
import { authService, type AuthUser } from "@/services/auth.service";
import { getErrorMessage } from "@/services/api";
import { useAuthStore } from "@/stores/authStore";
import { cn, formatDate, timeAgo } from "@/lib/utils";

const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Le nom doit contenir au moins 2 caractères")
    .max(100, "Le nom ne peut pas dépasser 100 caractères"),
  email: z.string().trim().toLowerCase().email("Email invalide"),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Le mot de passe actuel est requis"),
    newPassword: z
      .string()
      .min(12, "Le mot de passe doit faire au moins 12 caractères")
      .max(128, "Le mot de passe ne peut pas dépasser 128 caractères")
      .regex(/[A-Z]/, "Le mot de passe doit contenir au moins une majuscule")
      .regex(/[a-z]/, "Le mot de passe doit contenir au moins une minuscule")
      .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre")
      .regex(
        /[^A-Za-z0-9]/,
        "Le mot de passe doit contenir au moins un caractère spécial",
      ),
    confirmPassword: z.string().min(1, "Confirmez le nouveau mot de passe"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

type ProfileValues = z.infer<typeof profileSchema>;
type PasswordValues = z.infer<typeof passwordSchema>;

const PASSWORD_CRITERIA: Array<{
  label: string;
  test: (value: string) => boolean;
}> = [
  { label: "12 caractères minimum", test: (value) => value.length >= 12 },
  { label: "Une majuscule", test: (value) => /[A-Z]/.test(value) },
  { label: "Une minuscule", test: (value) => /[a-z]/.test(value) },
  { label: "Un chiffre", test: (value) => /[0-9]/.test(value) },
  {
    label: "Un caractère spécial",
    test: (value) => /[^A-Za-z0-9]/.test(value),
  },
];

function PasswordField({
  id,
  label,
  error,
  visible,
  onToggle,
  autoComplete,
  registration,
}: {
  id: string;
  label: string;
  error?: string;
  visible: boolean;
  onToggle: () => void;
  autoComplete?: string;
  registration: UseFormRegisterReturn;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          className="pr-10"
          aria-invalid={!!error}
          {...registration}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-slate-700 dark:hover:text-slate-200"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function ProfilePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user: storedUser, setUser, logout } = useAuthStore();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: user, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => authService.me(),
    initialData: storedUser ?? undefined,
  });

  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    mode: "onChange",
    defaultValues: {
      name: user?.name ?? "",
      email: user?.email ?? "",
    },
  });

  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    mode: "onChange",
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const { reset: resetProfile } = profileForm;
  const { reset: resetPassword } = passwordForm;

  useEffect(() => {
    if (!user) return;
    resetProfile({ name: user.name ?? "", email: user.email });
  }, [user, resetProfile]);

  useEffect(() => {
    if (user) setUser(user);
  }, [user, setUser]);

  const profileMutation = useMutation({
    mutationFn: (values: ProfileValues) => authService.updateProfile(values),
    onSuccess: (updated) => {
      const merged = { ...(storedUser ?? user), ...updated } as AuthUser;
      qc.setQueryData(["me"], merged);
      setUser(merged);
      resetProfile({ name: updated.name, email: updated.email });
      toast.show("success", "Profil mis à jour");
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const passwordMutation = useMutation({
    mutationFn: (values: PasswordValues) =>
      authService.changePassword(values.currentPassword, values.newPassword),
    onSuccess: async () => {
      resetPassword();
      // Le backend incrémente tokenVersion : toutes les sessions, y compris
      // celle-ci, sont désormais invalides.
      await authService.logout().catch(() => undefined);
      logout();
      toast.show(
        "success",
        "Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.",
      );
      navigate("/login", { replace: true });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const newPassword = passwordForm.watch("newPassword") ?? "";
  const confirmPassword = passwordForm.watch("confirmPassword") ?? "";
  const passwordScore = PASSWORD_CRITERIA.filter((criterion) =>
    criterion.test(newPassword),
  ).length;
  const passwordsMatch =
    confirmPassword.length > 0 && newPassword === confirmPassword;

  const strength = useMemo(() => {
    if (!newPassword) {
      return { label: "Aucun mot de passe saisi", tone: "bg-slate-500" };
    }
    if (passwordScore <= 2) return { label: "Faible", tone: "bg-red-500" };
    if (passwordScore <= 4) return { label: "Moyen", tone: "bg-amber-500" };
    return { label: "Fort", tone: "bg-emerald-500" };
  }, [newPassword, passwordScore]);

  if (isLoading && !user) {
    return (
      <div>
        <SettingsPageHeader title="Profil et identité" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Profil et identité"
        description="Gérez vos informations personnelles et votre mot de passe"
      />

      <Card className="overflow-hidden">
        <div className="h-20 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.28),transparent_45%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_45%)]" />
        <CardContent className="-mt-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-4 border-surface bg-primary-600 text-2xl font-bold text-white shadow-lg">
              {initials(user?.name)}
            </div>
            <div className="min-w-0 pb-1">
              <h2 className="truncate text-lg font-semibold">
                {user?.name ?? "Mon compte"}
              </h2>
              <p className="truncate text-sm text-muted">{user?.email}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <UserRoleBadge role={user?.role} />
                <UserStatusBadge status={user?.status} isActive={user?.isActive} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 pb-1 text-xs text-muted sm:grid-cols-2">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              Membre depuis {formatDate(user?.createdAt)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Dernière connexion {timeAgo(user?.lastLoginAt)}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-300">
                <User className="h-4 w-4" />
              </span>
              Informations personnelles
            </CardTitle>
            <p className="mt-1 text-xs text-muted">
              Ces informations sont visibles par les autres membres de la
              plateforme.
            </p>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={profileForm.handleSubmit((values) =>
                profileMutation.mutate(values),
              )}
              className="space-y-4"
              noValidate
            >
              <div>
                <label htmlFor="profile-name" className="mb-1 block text-sm">
                  Nom complet
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <Input
                    id="profile-name"
                    className="pl-9"
                    placeholder="Votre nom"
                    autoComplete="name"
                    aria-invalid={!!profileForm.formState.errors.name}
                    {...profileForm.register("name")}
                  />
                </div>
                {profileForm.formState.errors.name && (
                  <p className="mt-1 text-xs text-red-500">
                    {profileForm.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="profile-email" className="mb-1 block text-sm">
                  Adresse email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <Input
                    id="profile-email"
                    type="email"
                    className="pl-9"
                    placeholder="vous@exemple.com"
                    autoComplete="email"
                    aria-invalid={!!profileForm.formState.errors.email}
                    {...profileForm.register("email")}
                  />
                </div>
                {profileForm.formState.errors.email ? (
                  <p className="mt-1 text-xs text-red-500">
                    {profileForm.formState.errors.email.message}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted">
                    Cette adresse sert d'identifiant de connexion.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-muted">
                  {profileForm.formState.isDirty
                    ? "Modifications non enregistrées"
                    : "Aucune modification"}
                </span>
                <div className="flex gap-2">
                  {profileForm.formState.isDirty && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        resetProfile({
                          name: user?.name ?? "",
                          email: user?.email ?? "",
                        })
                      }
                    >
                      Annuler
                    </Button>
                  )}
                  <Button
                    type="submit"
                    loading={profileMutation.isPending}
                    disabled={!profileForm.formState.isDirty}
                  >
                    <Save className="h-4 w-4" />
                    Enregistrer
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-300">
                <Lock className="h-4 w-4" />
              </span>
              Mot de passe
            </CardTitle>
            <p className="mt-1 text-xs text-muted">
              Le changement de mot de passe révoque toutes vos sessions
              actives.
            </p>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={passwordForm.handleSubmit((values) =>
                passwordMutation.mutate(values),
              )}
              className="space-y-4"
              noValidate
            >
              <PasswordField
                id="current-password"
                label="Mot de passe actuel"
                autoComplete="current-password"
                visible={showCurrent}
                onToggle={() => setShowCurrent((value) => !value)}
                error={passwordForm.formState.errors.currentPassword?.message}
                registration={passwordForm.register("currentPassword")}
              />

              <PasswordField
                id="new-password"
                label="Nouveau mot de passe"
                autoComplete="new-password"
                visible={showNew}
                onToggle={() => setShowNew((value) => !value)}
                error={passwordForm.formState.errors.newPassword?.message}
                registration={passwordForm.register("newPassword")}
              />

              {newPassword && (
                <div className="rounded-lg border border-border bg-panel/60 p-3">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="text-muted">Robustesse</span>
                    <span
                      className={cn(
                        "font-medium",
                        passwordScore <= 2 && "text-red-500",
                        passwordScore > 2 &&
                          passwordScore <= 4 &&
                          "text-amber-500",
                        passwordScore > 4 && "text-emerald-500",
                      )}
                    >
                      {strength.label}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        strength.tone,
                      )}
                      style={{
                        width: `${(passwordScore / PASSWORD_CRITERIA.length) * 100}%`,
                      }}
                    />
                  </div>
                  <ul className="mt-3 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                    {PASSWORD_CRITERIA.map((criterion) => {
                      const passed = criterion.test(newPassword);
                      return (
                        <li
                          key={criterion.label}
                          className={cn(
                            "inline-flex items-center gap-1.5",
                            passed ? "text-emerald-600 dark:text-emerald-400" : "text-muted",
                          )}
                        >
                          {passed ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                          {criterion.label}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <PasswordField
                id="confirm-password"
                label="Confirmer le nouveau mot de passe"
                autoComplete="new-password"
                visible={showConfirm}
                onToggle={() => setShowConfirm((value) => !value)}
                error={passwordForm.formState.errors.confirmPassword?.message}
                registration={passwordForm.register("confirmPassword")}
              />

              {confirmPassword && (
                <p
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs",
                    passwordsMatch
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-500",
                  )}
                >
                  {passwordsMatch ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                  {passwordsMatch
                    ? "Les mots de passe correspondent"
                    : "Les mots de passe ne correspondent pas"}
                </p>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Argon2id · 12 caractères minimum
                </span>
                <Button
                  type="submit"
                  loading={passwordMutation.isPending}
                  disabled={!passwordForm.formState.isValid}
                >
                  <KeyRound className="h-4 w-4" />
                  Changer le mot de passe
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
