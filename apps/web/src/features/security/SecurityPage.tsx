import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Shield } from "lucide-react";

export function SecurityPage() {
  return (
    <div>
      <PageHeader title="Analyses de sécurité" description="Phase 8" />
      <EmptyState icon={Shield} title="Module Analyses" description="Sera implémenté en Phase 8." />
    </div>
  );
}