import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Github } from "lucide-react";

export function RepositoriesPage() {
  return (
    <div>
      <PageHeader title="Repositories" description="Intégration GitHub — Phase 5" />
      <EmptyState icon={Github} title="Module Repositories" description="Sera implémenté en Phase 5." />
    </div>
  );
}