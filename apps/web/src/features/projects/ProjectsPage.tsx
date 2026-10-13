import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { FolderGit2 } from "lucide-react";

export function ProjectsPage() {
  return (
    <div>
      <PageHeader title="Projets" description="Gestion de vos projets DevSecOps" />
      <EmptyState
        icon={FolderGit2}
        title="Module Projets"
        description="Cette page sera complétée en Phase 5 (intégration API)."
      />
    </div>
  );
}