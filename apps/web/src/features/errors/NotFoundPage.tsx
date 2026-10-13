import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/feedback/EmptyState";

export function NotFoundPage() {
  return (
    <EmptyState
      title="Page introuvable"
      description="La page que vous cherchez n'existe pas."
      action={
        <Link to="/dashboard">
          <Button>Retour au tableau de bord</Button>
        </Link>
      }
    />
  );
}