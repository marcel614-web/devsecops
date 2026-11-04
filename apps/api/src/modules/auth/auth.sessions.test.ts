// apps/api/src/modules/auth/auth.sessions.test.ts
import { Role } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createUser, resetDatabase } from "../../test/helpers";
import { prisma } from "../../utils/prisma";

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Révocation des sessions de l'utilisateur courant", () => {
  it("invalide immédiatement le jeton courant et journalise l'action", async () => {
    const user = await createUser({
      email: "sessions@test.local",
      role: Role.PLATFORM_USER,
    });

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(login.status).toBe(200);
    const token = login.body.accessToken as string;

    const revoke = await request(app)
      .post("/api/auth/sessions/revoke-all")
      .set("Authorization", `Bearer ${token}`);
    expect(revoke.status).toBe(204);

    // Le jeton émis avant la révocation ne doit plus être accepté.
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);

    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    expect(dbUser.tokenVersion).toBe(1);

    const audit = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: "USER_SESSIONS_REVOKED" },
      select: { id: true },
    });
    expect(audit).not.toBeNull();
  });

  it("exige une authentification", async () => {
    const res = await request(app).post("/api/auth/sessions/revoke-all");
    expect(res.status).toBe(401);
  });
});
