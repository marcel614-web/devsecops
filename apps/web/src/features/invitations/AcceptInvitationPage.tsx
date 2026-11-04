import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, MailWarning } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/layout/PageHeader";
import { useToast } from "@/components/feedback/Toast";
import { projectService } from "@/services/project.service";
import { getErrorMessage } from "@/services/api";

export function AcceptInvitationPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const toast = useToast();
  const [acceptedProjectId, setAcceptedProjectId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => projectService.acceptInvitation(token),
    onSuccess: (member) => {
      setAcceptedProjectId(member.projectId ?? null);
      toast.show("success", "Invitation acceptée");
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invitation à un projet"
        description="L'acceptation est vérifiée côté serveur : l'email du compte doit correspondre à l'invitation, et celle-ci doit être valide, non expirée et non révoquée."
      />

      <Card className="mx-auto max-w-xl rounded-2xl">
        <CardContent className="space-y-4 p-6 text-center">
          {acceptedProjectId ? (
            <>
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
              <h2 className="text-lg font-semibold">Invitation acceptée</h2>
              <p className="text-sm text-muted">
                Vous avez maintenant accès au projet.
              </p>
              <Link to={`/projects/${acceptedProjectId}`}>
                <Button>Ouvrir le projet</Button>
              </Link>
            </>
          ) : token ? (
            <>
              <MailWarning className="mx-auto h-10 w-10 text-amber-500" />
              <h2 className="text-lg font-semibold">Confirmer l'acceptation</h2>
              <p className="text-sm text-muted">
                En continuant, vous rejoindrez le projet avec le rôle défini par
                l'invitation.
              </p>
              <Button
                onClick={() => mutation.mutate()}
                loading={mutation.isPending}
                disabled={mutation.isPending}
              >
                Accepter l'invitation
              </Button>
            </>
          ) : (
            <>
              <MailWarning className="mx-auto h-10 w-10 text-red-500" />
              <h2 className="text-lg font-semibold">Jeton manquant</h2>
              <p className="text-sm text-muted">
                Le lien d'invitation est incomplet ou invalide.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
