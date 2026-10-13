import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Settings } from "lucide-react";

export function SettingsPage() {
  return (
    <div>
      <PageHeader title="Paramètres" description="Phase 10" />
      <EmptyState icon={Settings} title="Module Paramètres" description="Sera implémenté en Phase 10." />
    </div>
  );
}