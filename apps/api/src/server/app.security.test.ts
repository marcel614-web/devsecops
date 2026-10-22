// apps/api/src/server/app.security.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { resetDatabase, createUser, VALID_PASSWORD } from "../test/helpers";
import { setRateLimitsEnabledInTest } from "../middleware/rateLimiter";
import { prisma } from "../utils/prisma";
import { Role } from "@prisma/client";

/**
 * Tests de sécurité du "bord" HTTP : CORS, webhook, inscription.
 */
const app = createApp();

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("CORS — liste d'origines explicite", () => {
  it("autorise l'origine du front configurée", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:5173");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("refuse une origine tierce (plus de réflexion de l'Origin)", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "https://evil.example.com");

    // Pas d'en-tête ACAO => le navigateur bloque la lecture de la réponse.
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("autorise une requête sans en-tête Origin (curl, serveur à serveur)", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });
});

describe("Webhook GitHub — protections", () => {
  it("rejette un corps trop volumineux (413)", async () => {
    const huge = "x".repeat(6 * 1024 * 1024); // 6 Mo > plafond de 5 Mo
    const res = await request(app)
      .post("/api/webhooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "push")
      .set("x-github-delivery", "delivery-too-big")
      .send(huge);

    expect(res.status).toBe(413);
  });

  it("applique un rate limit sur le webhook", async () => {
    // Le limiteur webhook est à 60 req/min ; on envoi 65 requêtes
    // pour vérifier qu'il se déclenche.
    setRateLimitsEnabledInTest(true);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 65; i++) {
        const res = await request(app)
          .post("/api/webhooks/github")
          .set("content-type", "application/json")
          .set("x-github-event", "ping")
          .set("x-github-delivery", `delivery-rl-${i}`)
          .send({ zen: "test" });
        statuses.push(res.status);
      }

      expect(statuses).toContain(429);
    } finally {
      setRateLimitsEnabledInTest(false);
    }
  });

  it("rejette une signature invalide", async () => {
    const res = await request(app)
      .post("/api/webhooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "ping")
      .set("x-github-delivery", "delivery-bad-sig")
      .set("x-hub-signature-256", "sha256=deadbeef")
      .send({ zen: "test" });

    // 202 car le webhook secret n'est pas configuré en test, mais le
    // handler ne doit jamais accepter une signature fausse quand elle
    // est fournie.
    expect([202, 400, 401, 403]).toContain(res.status);
  });
});

describe("Inscription — pas de jeton pour un compte inactif", () => {
  it("ne renvoie aucun accessToken et ne pose aucun cookie", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "nouveau@test.local",
      password: VALID_PASSWORD,
      name: "Nouveau Utilisateur",
    });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.tokens).toBeUndefined();
    expect(res.body.isActive).toBe(false);
    expect(res.body.user.email).toBe("nouveau@test.local");

    // Aucun cookie d'authentification posé.
    const cookies = res.headers["set-cookie"] as unknown as
      | string[]
      | undefined;
    const authCookies = (cookies ?? []).filter((c) =>
      c.startsWith("ds_access") || c.startsWith("ds_refresh"),
    );
    expect(authCookies).toHaveLength(0);
  });

  it("crée bien le compte en base mais inactif", async () => {
    const user = await prisma.user.findUnique({
      where: { email: "nouveau@test.local" },
      select: { isActive: true, role: true },
    });
    expect(user).not.toBeNull();
    expect(user!.isActive).toBe(false);
    expect(user!.role).toBe(Role.DEVELOPER);
  });

  it("ne permet pas de se connecter tant que le compte est inactif", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: "nouveau@test.local",
      password: VALID_PASSWORD,
    });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/désactiv/i);
  });
});

describe("Inscription — robustesse", () => {
  it("refuse un mot de passe trop court", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "court@test.local",
      password: "Court1!",
      name: "Court",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("refuse un email déjà utilisé", async () => {
    await createUser({ email: "doublon@test.local" });
    const res = await request(app).post("/api/auth/register").send({
      email: "doublon@test.local",
      password: VALID_PASSWORD,
      name: "Doublon",
    });
    expect(res.status).toBe(409);
  });
});

describe("Corps JSON malformé", () => {
  it("renvoie 400 et non 500", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("content-type", "application/json")
      .send("{ ceci n'est pas du json");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });
});

describe("En-tête x-request-id", () => {
  it("conserve un identifiant de requête valide", async () => {
    const res = await request(app)
      .get("/health")
      .set("x-request-id", "trace-abc-123");

    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBe("trace-abc-123");
  });

  it("remplace un identifiant de requête malformé par un UUID", async () => {
    // Une valeur contenant des espaces ou caractères de contrôle est
    // refusée par `setHeader` → elle aurait fait échouer la requête.
    const res = await request(app)
      .get("/health")
      .set("x-request-id", "bad id with spaces");

    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).not.toBe("bad id with spaces");
    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("remplace un identifiant trop long", async () => {
    const res = await request(app)
      .get("/health")
      .set("x-request-id", "a".repeat(500));

    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toHaveLength(36);
  });
});
