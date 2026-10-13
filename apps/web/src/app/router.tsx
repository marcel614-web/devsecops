// apps/web/src/app/router.tsx
import { Navigate, Route, Routes } from "react-router-dom";
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
import { NotFoundPage } from "@/features/errors/NotFoundPage";

export function AppRouter() {
  return (
    <Routes>
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

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />

        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route
          path="projects/:projectId/pipelines/:pipelineId"
          element={<PipelineDetailPage />}
        />

        <Route path="repositories" element={<RepositoriesPage />} />

        <Route path="pipelines" element={<PipelinesPage />} />
        <Route path="pipelines/:pipelineId" element={<PipelineDetailPage />} />

        <Route path="security" element={<SecurityPage />} />
        <Route path="vulnerabilities" element={<VulnerabilitiesPage />} />
        <Route path="servers" element={<ServersPage />} />
        <Route path="deployments" element={<DeploymentsPage />} />
        <Route path="reports" element={<ReportsPage />} />

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

        <Route path="settings" element={<SettingsPage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}