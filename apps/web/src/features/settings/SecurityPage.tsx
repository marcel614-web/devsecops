import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";

export function SecurityPage() {
  return (
    <div>
      <PageHeader title="Sécurité" description="Sessions et sécurité du compte" />
      <Card>
        <CardContent className="py-6 space-y-3">
          <p className="text-sm text-muted">
            La gestion des sessions actives et de l'historique de connexion sera ajoutée
            dans une prochaine version.
          </p>
          <p className="text-sm">
            Pour changer votre mot de passe, utilisez la page <strong>Profil</strong>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}