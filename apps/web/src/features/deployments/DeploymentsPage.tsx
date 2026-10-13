// apps/web/src/features/deployments/DeploymentsPage.tsx
import { Rocket, Construction } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export function DeploymentsPage() {
  return (
    <div>
      <PageHeader
        title="Déploiements"
        description="Historique des déploiements"
      />

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center mb-4">
            <Construction className="w-7 h-7 text-amber-500" />
          </div>
          <h3 className="font-semibold text-lg mb-2">
            Module Déploiements en préparation
          </h3>
          <p className="text-sm text-muted max-w-md mb-6">
            L'étape de déploiement SSH vers un serveur Ubuntu sera bientôt disponible.
            En attendant, tu peux configurer tes serveurs de déploiement.
          </p>
          <Link to="/servers">
            <Button>
              <Rocket className="w-4 h-4" /> Gérer les serveurs
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}