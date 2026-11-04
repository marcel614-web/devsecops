// apps/web/src/features/settings/SettingsPageHeader.tsx
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

interface Props {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

/**
 * En-tête commun aux sous-pages de paramètres : conserve un retour vers le
 * hub et évite de dupliquer le fil d'Ariane dans chaque page.
 */
export function SettingsPageHeader({ title, description, actions }: Props) {
  return (
    <div>
      <Link
        to="/settings"
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-slate-700 dark:hover:text-slate-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Paramètres
      </Link>
      <PageHeader title={title} description={description} actions={actions} />
    </div>
  );
}
