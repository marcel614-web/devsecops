import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { GitBranch } from "lucide-react";

export function PipelineDetailPage() {
  return (
    <div>
      <PageHeader title="Détail du pipeline" description="Phase 6" />
      <EmptyState icon={GitBranch} title="Détail pipeline" description="Sera implémenté en Phase 6." />
    </div>
  );
}