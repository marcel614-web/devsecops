import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Props {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({ title = "Erreur", description = "Une erreur est survenue.", onRetry }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
        <AlertCircle className="w-6 h-6 text-red-500" />
      </div>
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm text-muted mt-1 max-w-sm">{description}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}