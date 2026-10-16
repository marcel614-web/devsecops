import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/feedback/Toast";
import { authService } from "@/services/auth.service";
import { getErrorMessage } from "@/services/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User, Lock } from "lucide-react";

export function ProfilePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: () => authService.me() });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  if (user && !loaded) {
    setName(user.name ?? "");
    setEmail(user.email);
    setLoaded(true);
  }

  const updateMutation = useMutation({
    mutationFn: () => authService.updateProfile({ name, email }),
    onSuccess: () => {
      toast.show("success", "Profil mis à jour");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const passwordMutation = useMutation({
    mutationFn: () => authService.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      toast.show("success", "Mot de passe changé");
      setCurrentPassword("");
      setNewPassword("");
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Profil" description="Gérer vos informations personnelles et votre mot de passe" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardContent className="space-y-4 py-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-primary-600/15 flex items-center justify-center">
                <User className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h3 className="font-semibold">Informations</h3>
                <p className="text-xs text-muted">Nom et email de connexion</p>
              </div>
            </div>
            <Input placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button onClick={() => updateMutation.mutate()} loading={updateMutation.isPending}>
              Enregistrer
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="space-y-4 py-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                <Lock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold">Mot de passe</h3>
                <p className="text-xs text-muted">Changer votre mot de passe</p>
              </div>
            </div>
            <Input
              placeholder="Mot de passe actuel"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <Input
              placeholder="Nouveau mot de passe"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Button onClick={() => passwordMutation.mutate()} loading={passwordMutation.isPending}>
              Changer le mot de passe
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}