import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ScrollText } from "lucide-react";

export function AuditPage() {
  return (
    <div>
      <PageHeader title="Journal d'audit" description="Phase 10" />
      <EmptyState icon={ScrollText} title="Module Audit" description="Sera implémenté en Phase 10." />
    </div>
  );
}