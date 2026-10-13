// apps/web/src/features/auth/RegisterPage.tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { authService } from "@/services/auth.service";
import { getErrorMessage } from "@/services/api";
import { useAuthStore } from "@/stores/authStore";

const passwordSchema = z
  .string()
  .min(12, "Minimum 12 caractères")
  .max(128, "Maximum 128 caractères")
  .regex(/[A-Z]/, "Au moins une majuscule")
  .regex(/[a-z]/, "Au moins une minuscule")
  .regex(/[0-9]/, "Au moins un chiffre")
  .regex(/[^A-Za-z0-9]/, "Au moins un caractère spécial");

const schema = z
  .object({
    name: z.string().trim().min(2, "Nom trop court").max(100, "Nom trop long"),
    email: z.string().trim().toLowerCase().email("Email invalide"),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    path: ["confirm"],
    message: "Les mots de passe ne correspondent pas",
  });

type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const { setUser } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      const res = await authService.register(values.email, values.password, values.name);
      localStorage.setItem("accessToken", res.accessToken);
      setUser(res.user);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setServerError(getErrorMessage(err));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-md p-6">
        <div className="text-center mb-6">
          <div className="inline-flex w-10 h-10 rounded-md bg-primary-600 items-center justify-center text-white font-bold mb-3">
            DS
          </div>
          <h1 className="text-2xl font-bold">Inscription</h1>
          <p className="text-sm text-muted mt-1">Créer un compte DEVELOPER</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label className="block text-sm mb-1">Nom complet</label>
            <Input autoFocus {...register("name")} />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="block text-sm mb-1">Email</label>
            <Input type="email" autoComplete="email" {...register("email")} />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block text-sm mb-1">Mot de passe</label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                className="pr-10"
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
            <p className="text-xs text-muted mt-1">
              Min 12 car., 1 maj., 1 min., 1 chiffre, 1 spécial
            </p>
          </div>

          <div>
            <label className="block text-sm mb-1">Confirmer le mot de passe</label>
            <Input type="password" autoComplete="new-password" {...register("confirm")} />
            {errors.confirm && <p className="text-xs text-red-500 mt-1">{errors.confirm.message}</p>}
          </div>

          {serverError && (
            <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2">
              {serverError}
            </div>
          )}

          <Button type="submit" className="w-full" loading={isSubmitting}>
            Créer un compte
          </Button>
        </form>

        <p className="text-sm text-muted text-center mt-4">
          Déjà un compte ?{" "}
          <Link to="/login" className="text-primary-500 hover:underline">
            Se connecter
          </Link>
        </p>
      </Card>
    </div>
  );
}