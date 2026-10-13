import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

export function RegisterPage() {
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

        <form className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Nom complet</label>
            <Input required />
          </div>
          <div>
            <label className="block text-sm mb-1">Email</label>
            <Input type="email" required />
          </div>
          <div>
            <label className="block text-sm mb-1">Mot de passe</label>
            <Input type="password" required />
            <p className="text-xs text-muted mt-1">
              Min 12 car., 1 maj., 1 min., 1 chiffre, 1 spécial
            </p>
          </div>
          <Button type="submit" className="w-full">Créer un compte</Button>
        </form>

        <p className="text-sm text-muted text-center mt-4">
          Déjà un compte ? <Link to="/login" className="text-primary-500 hover:underline">Se connecter</Link>
        </p>
      </Card>
    </div>
  );
}