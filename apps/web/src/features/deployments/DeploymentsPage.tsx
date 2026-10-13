import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Rocket } from "lucide-react";

export function DeploymentsPage() {
  return (
    <div>
      <PageHeader title="Déploiements" description="Phase 9" />
      <EmptyState icon={Rocket} title="Module Déploiements" description="Sera implémenté en Phase 9." />
    </div>
  );
}