// apps/api/src/middleware/rawBody.test.ts
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { rawBodyMiddleware, MAX_RAW_BODY_BYTES } from "./rawBody";
import { errorHandler } from "./errorHandler";

function buildApp() {
  const app = express();
  app.post(
    "/raw",
    rawBodyMiddleware,
    (req, res) => {
      const raw = (req as Request & { rawBody?: string }).rawBody ?? "";
      res.json({ rawLength: raw.length });
    },
  );
  app.use(errorHandler);
  return app;
}

describe("rawBodyMiddleware", () => {
  const app = buildApp();

  it("capture le corps brut et le rend disponible", async () => {
    const res = await request(app)
      .post("/raw")
      .set("content-type", "application/json")
      .send({ hello: "world" });

    expect(res.status).toBe(200);
    expect(res.body.rawLength).toBe(JSON.stringify({ hello: "world" }).length);
  });

  it("accepte un corps juste sous le plafond", async () => {
    const payload = "a".repeat(1024);
    const res = await request(app)
      .post("/raw")
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
  });

  it("rejette un corps au-delà du plafond avec un 413", async () => {
    const payload = "a".repeat(MAX_RAW_BODY_BYTES + 1024);
    const res = await request(app)
      .post("/raw")
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("ne conserve pas le corps partiel après refus", async () => {
    const payload = "a".repeat(MAX_RAW_BODY_BYTES + 1024);
    const res = await request(app)
      .post("/raw")
      .set("content-type", "application/json")
      .send(payload);

    // Aucune fuite de contenu dans la réponse d'erreur.
    expect(JSON.stringify(res.body)).not.toContain("aaaaaaaaaa");
    expect(res.body.error.message).not.toMatch(/a{10,}/);
  });

  it("tolère un corps JSON malformé sans planter", async () => {
    const res = await request(app)
      .post("/raw")
      .set("content-type", "application/json")
      .send("{ pas du json");

    // Le middleware met `req.body = {}` mais le corps brut est capturé.
    expect(res.status).toBe(200);
  });
});
