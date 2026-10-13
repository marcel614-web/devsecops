import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { GitBranch } from "lucide-react";

export function PipelinesPage() {
  return (
    <div>
      <PageHeader title="Pipelines" description="Suivi des pipelines CI/CD — Phase 6" />
      <EmptyState icon={GitBranch} title="Module Pipelines" description="Sera implémenté en Phase 6." />
    </div>
  );
}