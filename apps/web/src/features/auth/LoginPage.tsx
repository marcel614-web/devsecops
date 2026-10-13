import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/stores/authStore";
import { useNavigate } from "react-router-dom";

// ⚠️ PHASE 2 : connexion factice. L'auth réelle sera branchée en Phase 3.
export function LoginPage() {
  const navigate = useNavigate();
  const { setUser } = useAuthStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setUser({
      id: "demo",
      email: "demo@devsecops.local",
      name: "Utilisateur Démo",
      role: "ADMIN",
    });
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-md p-6">
        <div className="text-center mb-6">
          <div className="inline-flex w-10 h-10 rounded-md bg-primary-600 items-center justify-center text-white font-bold mb-3">
            DS
          </div>
          <h1 className="text-2xl font-bold">Connexion</h1>
          <p className="text-sm text-muted mt-1">Plateforme DevSecOps</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <Input type="email" placeholder="admin@devsecops.local" required />
          </div>
          <div>
            <label className="block text-sm mb-1">Mot de passe</label>
            <Input type="password" placeholder="••••••••" required />
          </div>
          <Button type="submit" className="w-full">Se connecter</Button>
        </form>

        <p className="text-sm text-muted text-center mt-4">
          Pas de compte ? <Link to="/register" className="text-primary-500 hover:underline">S'inscrire</Link>
        </p>
        <p className="text-xs text-muted text-center mt-2 italic">
          (Auth réelle activée en Phase 3)
        </p>
      </Card>
    </div>
  );
}