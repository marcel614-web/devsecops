// apps/api/src/modules/authorization/rbac.test.ts
import {
  PermissionScopeType,
  ProjectMemberStatus,
  ProjectRole,
  Role,
  SpecialPermission,
  UserStatus,
} from "@prisma/client";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { prisma } from "../../utils/prisma";
import { ConflictError, ForbiddenError } from "../../utils/errors";
import {
  createProject,
  createUser,
  resetDatabase,
  type TestUser,
} from "../../test/helpers";
import {
  acceptProjectInvitation,
  inviteProjectMember,
  revokeProjectInvitation,
  updateProjectMemberRole,
} from "../projects/project-members.service";
import {
  getEffectivePermissions,
  requirePermission,
} from "./permission.service";
import { PERMISSIONS } from "./permissions.constants";

const app = createApp();

async function login(user: TestUser): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: user.email, password: user.password });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

async function addMember(
  projectId: string,
  userId: string,
  role: ProjectRole,
  status: ProjectMemberStatus = ProjectMemberStatus.ACTIVE,
) {
  return prisma.projectMember.create({
    data: { projectId, userId, role, status },
    select: { id: true, userId: true, role: true },
  });
}

async function actorFor(user: TestUser) {
  const dbUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { id: true, role: true, status: true },
  });
  return dbUser;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("RBAC global", () => {
  it("réserve l'administration des utilisateurs à PLATFORM_ADMIN", async () => {
    const admin = await createUser({
      email: "admin@rbac.local",
      role: Role.PLATFORM_ADMIN,
    });
    const user = await createUser({
      email: "user@rbac.local",
      role: Role.PLATFORM_USER,
    });

    const adminToken = await login(admin);
    const userToken = await login(user);

    await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(403);
  });

  it("refuse l'accès direct à un projet dont l'utilisateur n'est pas membre", async () => {
    const owner = await createUser({
      email: "owner-a@rbac.local",
      role: Role.PLATFORM_USER,
    });
    const outsider = await createUser({
      email: "outsider@rbac.local",
      role: Role.PLATFORM_USER,
    });
    const project = await createProject(owner.id, {
      name: "Projet A",
      repoFullName: "acme/a",
    });
    await addMember(project.id, owner.id, ProjectRole.OWNER);
    const token = await login(outsider);

    await request(app)
      .get(`/api/projects/${project.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);

    await request(app)
      .get(`/api/projects/${project.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);

    await request(app)
      .get(`/api/projects/${project.id}/pipelines`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("expose les permissions globales et ouvre l'audit avec VIEW_SECURITY_AUDIT", async () => {
    const admin = await createUser({
      email: "audit-admin@rbac.local",
      role: Role.PLATFORM_ADMIN,
    });
    const user = await createUser({
      email: "audit-reader@rbac.local",
      role: Role.PLATFORM_USER,
    });
    await prisma.permissionGrant.create({
      data: {
        userId: user.id,
        permission: SpecialPermission.VIEW_SECURITY_AUDIT,
        scopeType: PermissionScopeType.GLOBAL,
        scopeId: null,
        grantedById: admin.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "ADMIN_ACTION_FOR_AUDIT",
        targetType: "Test",
        targetId: "audit-target",
      },
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.globalPermissions).toContain("audit_log:read");

    const token = loginRes.body.accessToken as string;
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(meRes.body.user.globalPermissions).toContain("audit_log:read");

    const auditRes = await request(app)
      .get("/api/audit-logs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(auditRes.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "ADMIN_ACTION_FOR_AUDIT" }),
      ]),
    );
  });

  it("bloque immédiatement un compte suspendu même avec un JWT valide", async () => {
    const user = await createUser({
      email: "suspended@rbac.local",
      role: Role.PLATFORM_USER,
    });
    const token = await login(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { status: UserStatus.SUSPENDED, isActive: false, tokenVersion: { increment: 1 } },
    });

    await request(app)
      .get("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });
});

describe("isolation et permissions projet", () => {
  it("ne propage pas une permission spéciale d'un projet à un autre", async () => {
    const user = await createUser({
      email: "scoped@rbac.local",
      role: Role.PLATFORM_USER,
    });
    const projectA = await createProject(user.id, {
      name: "Projet A",
      repoFullName: "acme/scope-a",
    });
    const projectB = await createProject(user.id, {
      name: "Projet B",
      repoFullName: "acme/scope-b",
    });
    await addMember(projectA.id, user.id, ProjectRole.DEVELOPER);
    await addMember(projectB.id, user.id, ProjectRole.DEVELOPER);

    const actor = await actorFor(user);
    await prisma.permissionGrant.create({
      data: {
        userId: user.id,
        permission: SpecialPermission.MANAGE_DEPLOYMENTS,
        scopeType: PermissionScopeType.PROJECT,
        scopeId: projectB.id,
        grantedById: user.id,
      },
    });

    const permissionsA = await getEffectivePermissions(actor, projectA.id);
    const permissionsB = await getEffectivePermissions(actor, projectB.id);

    expect(permissionsA.has(PERMISSIONS.DEPLOYMENT_CREATE)).toBe(false);
    expect(permissionsB.has(PERMISSIONS.DEPLOYMENT_CREATE)).toBe(true);
    await expect(
      requirePermission(actor, PERMISSIONS.DEPLOYMENT_CREATE, {
        projectId: projectA.id,
        auditDenied: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ignore une permission spéciale expirée", async () => {
    const user = await createUser({
      email: "expired-grant@rbac.local",
      role: Role.PLATFORM_USER,
    });
    const project = await createProject(user.id, {
      name: "Projet expiré",
      repoFullName: "acme/expired",
    });
    await addMember(project.id, user.id, ProjectRole.DEVELOPER);

    await prisma.permissionGrant.create({
      data: {
        userId: user.id,
        permission: SpecialPermission.MANAGE_DEPLOYMENTS,
        scopeType: PermissionScopeType.PROJECT,
        scopeId: project.id,
        grantedById: user.id,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const permissions = await getEffectivePermissions(
      await actorFor(user),
      project.id,
    );
    expect(permissions.has(PERMISSIONS.DEPLOYMENT_CREATE)).toBe(false);
  });
});

describe("invitations", () => {
  it("refuse une invitation expirée", async () => {
    const owner = await createUser({
      email: "owner-invite@rbac.local",
      role: Role.PLATFORM_USER,
    });
    const invitee = await createUser({
      email: "invitee-expired@rbac.local",
      role: Role.PLATFORM_USER,
    });
    const project = await createProject(owner.id, {
      name: "Projet invitation",
      repoFullName: "acme/invite",
    });
    await addMember(project.id, owner.id, ProjectRole.OWNER);

    const created = await inviteProjectMember(
      await actorFor(owner),
      project.id,
      { email: invitee.email, role: ProjectRole.DEVELOPER, expiresInDays: 7 },
    );
    await prisma.projectInvitation.update({
      where: { id: created.invitation.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await expect(
      acceptProjectInvitation(await actorFor(invitee), {
        token: created.token,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuse une invitation révoquée", async () => {
    const owner = await createUser({
      email: "owner-revoke@rbac.local",
      role: Role.PLATFORM_USER,
    });
    const invitee = await createUser({
      email: "invitee-revoked@rbac.local",
      role: Role.PLATFORM_USER,
    });
    const project = await createProject(owner.id, {
      name: "Projet révocation",
      repoFullName: "acme/revoke",
    });
    await addMember(project.id, owner.id, ProjectRole.OWNER);
    const ownerActor = await actorFor(owner);

    const created = await inviteProjectMember(ownerActor, project.id, {
      email: invitee.email,
      role: ProjectRole.DEVELOPER,
      expiresInDays: 7,
    });
    await revokeProjectInvitation(
      ownerActor,
      project.id,
      created.invitation.id,
    );

    await expect(
      acceptProjectInvitation(await actorFor(invitee), {
        token: created.token,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("protection du dernier OWNER", () => {
  it("interdit de rétrograder ou retirer le dernier OWNER", async () => {
    const owner = await createUser({
      email: "last-owner@rbac.local",
      role: Role.PLATFORM_USER,
    });
    const project = await createProject(owner.id, {
      name: "Projet owner",
      repoFullName: "acme/owner",
    });
    const membership = await addMember(
      project.id,
      owner.id,
      ProjectRole.OWNER,
    );
    const actor = await actorFor(owner);

    await expect(
      updateProjectMemberRole(actor, project.id, membership.id, {
        role: ProjectRole.DEVELOPER,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const stored = await prisma.projectMember.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(stored.role).toBe(ProjectRole.OWNER);
  });
});
