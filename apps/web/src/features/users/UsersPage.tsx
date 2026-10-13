import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Users } from "lucide-react";

export function UsersPage() {
  return (
    <div>
      <PageHeader title="Utilisateurs" description="Réservé à l'administrateur — Phase 10" />
      <EmptyState icon={Users} title="Module Utilisateurs" description="Sera implémenté en Phase 10." />
    </div>
  );
}