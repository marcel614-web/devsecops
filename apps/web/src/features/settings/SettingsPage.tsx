// apps/web/src/features/settings/SettingsPage.tsx
import { Link } from "react-router-dom";
import {
  Github,
  User,
  Shield,
  Bell,
  Palette,
  ChevronRight,
  Server,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { useAuthStore } from "@/stores/authStore";

interface SettingsItem {
  to: string;
  icon: typeof User;
  title: string;
  description: string;
  adminOnly?: boolean;
}

const SETTINGS_ITEMS: SettingsItem[] = [
  {
    to: "/settings/github",
    icon: Github,
    title: "GitHub App",
    description:
      "Configurer l'intégration GitHub App (App ID, clé privée, webhook secret)",
    adminOnly: true,
  },
  {
    to: "/settings/profile",
    icon: User,
    title: "Profil",
    description: "Modifier votre nom, email et mot de passe",
  },
  {
    to: "/settings/security",
    icon: Shield,
    title: "Sécurité",
    description: "Sessions actives, historique de connexion",
  },
  {
    to: "/settings/notifications",
    icon: Bell,
    title: "Notifications",
    description: "Configurer les alertes email et in-app",
  },
  {
    to: "/settings/appearance",
    icon: Palette,
    title: "Apparence",
    description: "Thème clair / sombre, langue",
  },
  {
    to: "/settings/servers",
    icon: Server,
    title: "Serveurs par défaut",
    description: "Serveurs de déploiement favoris",
  },
];

export function SettingsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN";

  const visibleItems = SETTINGS_ITEMS.filter(
    (item) => !item.adminOnly || isAdmin,
  );

  return (
    <div>
      <PageHeader
        title="Paramètres"
        description="Gérez votre compte et la configuration de la plateforme"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to}>
              <Card className="hover:border-primary-500/60 cursor-pointer transition-colors h-full">
                <CardContent className="flex items-start gap-4 py-4">
                  <div className="w-10 h-10 rounded-lg bg-primary-600/15 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-primary-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-sm">{item.title}</h3>
                      <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                    </div>
                    <p className="text-xs text-muted mt-1">
                      {item.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <p className="text-xs text-muted italic mt-6">
        Certaines sections sont réservées aux administrateurs.
      </p>
    </div>
  );
}