import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "@/app";
import { prisma } from "@/lib/prisma";
import { resetDatabase, seedMinimalFixtures } from "./helpers";

const app = createApp();

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it("devuelve un token válido con credenciales correctas", async () => {
    const fixtures = await seedMinimalFixtures(request(app));
    expect(fixtures.adminToken).toBeTruthy();

    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${fixtures.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.companyId).toBe(fixtures.companyId);
  });

  it("rechaza credenciales incorrectas con 401", async () => {
    await seedMinimalFixtures(request(app));
    const res = await request(app).post("/api/auth/login").send({ email: "nadie@test.local", password: "malapass" });
    expect(res.status).toBe(401);
  });

  it("rechaza rutas protegidas sin token con 401", async () => {
    const res = await request(app).get("/api/customers");
    expect(res.status).toBe(401);
  });

  it("rechaza tokens inválidos con 401", async () => {
    const res = await request(app).get("/api/customers").set("Authorization", "Bearer token-falso");
    expect(res.status).toBe(401);
  });
});
