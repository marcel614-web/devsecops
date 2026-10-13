import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { FileText } from "lucide-react";

export function ReportsPage() {
  return (
    <div>
      <PageHeader title="Rapports" description="Phase 10" />
      <EmptyState icon={FileText} title="Module Rapports" description="Sera implémenté en Phase 10." />
    </div>
  );
}