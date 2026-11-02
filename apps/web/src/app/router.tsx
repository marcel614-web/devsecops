// apps/web/src/app/router.tsx
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { GuestRoute, ProtectedRoute, RoleGuard } from "./guards";

import { LoginPage } from "@/features/auth/LoginPage";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { ProjectDetailPage } from "@/features/projects/ProjectDetailPage";
import { RepositoriesPage } from "@/features/repositories/RepositoriesPage";
import { PipelinesPage } from "@/features/pipelines/PipelinesPage";
import { PipelineDetailPage } from "@/features/pipelines/PipelineDetailPage";
import { SecurityPage } from "@/features/security/SecurityPage";
import { VulnerabilitiesPage } from "@/features/vulnerabilities/VulnerabilitiesPage";
import { ServersPage } from "@/features/servers/ServersPage";
import { DeploymentsPage } from "@/features/deployments/DeploymentsPage";
import { ReportsPage } from "@/features/reports/ReportsPage";
import { UsersPage } from "@/features/users/UsersPage";
import { AuditPage } from "@/features/audit/AuditPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { DefectDojoSettingsPage } from "@/features/settings/DefectDojoSettingsPage";
import { GithubSettingsPage } from "@/features/settings/GithubSettingsPage";
import { ProfilePage } from "@/features/settings/ProfilePage";
import { SecurityPage as SettingsSecurityPage } from "@/features/settings/SecurityPage";
import { NotificationsPage } from "@/features/settings/NotificationsPage";
import { NotificationsInboxPage } from "@/features/notifications/NotificationsInboxPage";
import { AppearancePage } from "@/features/settings/AppearancePage";
import { ServersDefaultPage } from "@/features/settings/ServersDefaultPage";
import { NotFoundPage } from "@/features/errors/NotFoundPage";

/**
 * Les sous-sections d'un projet n'ont pas de route autonome : elles sont
 * affichées via l'onglet du projet (`?tab=...`). Ce composant redirige les
 * URLs "profondes" (ex. `/projects/:id/pipelines` issu d'un fil d'Ariane ou
 * d'un ancien lien) vers l'onglet correspondant.
 */
function ProjectSectionRedirect({ tab }: { tab: string }) {
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/projects/${projectId}?tab=${tab}`} replace />;
}

export function AppRouter() {
  return (
    <Routes>
      {/* ------------------------------------------------------
          Routes publiques (non authentifié uniquement)
      ------------------------------------------------------ */}
      <Route
        path="/login"
        element={
          <GuestRoute>
            <LoginPage />
          </GuestRoute>
        }
      />
      <Route
        path="/register"
        element={
          <GuestRoute>
            <RegisterPage />
          </GuestRoute>
        }
      />

      {/* ------------------------------------------------------
          Routes protégées
      ------------------------------------------------------ */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />

        {/* Dashboard */}
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="notifications" element={<NotificationsInboxPage />} />

        {/* Projets */}
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route
          path="projects/:projectId/pipelines"
          element={<ProjectSectionRedirect tab="pipelines" />}
        />
        <Route
          path="projects/:projectId/vulnerabilities"
          element={<ProjectSectionRedirect tab="vulnerabilities" />}
        />
        <Route
          path="projects/:projectId/config"
          element={<ProjectSectionRedirect tab="config" />}
        />
        <Route
          path="projects/:projectId/pipelines/:pipelineId"
          element={<PipelineDetailPage />}
        />

        {/* Repositories GitHub */}
        <Route path="repositories" element={<RepositoriesPage />} />

        {/* Pipelines */}
        <Route path="pipelines" element={<PipelinesPage />} />
        <Route path="pipelines/:pipelineId" element={<PipelineDetailPage />} />

        {/* Sécurité */}
        <Route path="security" element={<SecurityPage />} />
        <Route path="vulnerabilities" element={<VulnerabilitiesPage />} />

        {/* Déploiement */}
        <Route path="servers" element={<ServersPage />} />
        <Route path="deployments" element={<DeploymentsPage />} />

        {/* Rapports */}
        <Route path="reports" element={<ReportsPage />} />

        {/* Admin uniquement */}
        <Route
          path="users"
          element={
            <RoleGuard roles={["ADMIN"]}>
              <UsersPage />
            </RoleGuard>
          }
        />
        <Route
          path="audit-logs"
          element={
            <RoleGuard roles={["ADMIN"]}>
              <AuditPage />
            </RoleGuard>
          }
        />

        {/* Paramètres */}
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/profile" element={<ProfilePage />} />
        <Route path="settings/security" element={<SettingsSecurityPage />} />
        <Route path="settings/notifications" element={<NotificationsPage />} />
        <Route path="settings/appearance" element={<AppearancePage />} />
        <Route path="settings/servers" element={<ServersDefaultPage />} />
        <Route
          path="settings/github"
          element={
            <RoleGuard roles={["ADMIN"]}>
              <GithubSettingsPage />
            </RoleGuard>
          }
        />
        <Route
          path="settings/defectdojo"
          element={
            <RoleGuard roles={["ADMIN"]}>
              <DefectDojoSettingsPage />
            </RoleGuard>
          }
        />

        {/* 404 catch-all dans le layout */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}