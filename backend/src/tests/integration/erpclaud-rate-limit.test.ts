import request from "supertest";
import express from "express";
import { erpclaudIpRateLimiter } from "../../middleware/erpclaud-rate-limit";

// Test aislado del rate limiter en sí (sin tocar BD), montando una app
// mínima con un límite bajo forzado por env antes del import del módulo.
// Se separa del resto de tests de integración de erpclaud para no acoplar
// timing de rate-limit con lógica de negocio del bridge.

describe("erpclaudIpRateLimiter", () => {
  function buildApp() {
    const app = express();
    app.use(erpclaudIpRateLimiter);
    app.get("/ping", (_req, res) => res.status(200).json({ ok: true }));
    return app;
  }

  it("permite peticiones dentro del límite configurado", async () => {
    const app = buildApp();
    const res = await request(app).get("/ping");
    expect(res.status).toBe(200);
    // El header estándar RateLimit-* debe estar presente (standardHeaders: true)
    expect(res.headers["ratelimit-limit"]).toBeDefined();
  });

  it("devuelve 429 y el cuerpo de error esperado al superar el límite por IP", async () => {
    const app = buildApp();
    const limit = Number(process.env.ERPCLAUD_RATE_LIMIT_MAX_PER_IP ?? 30);

    let lastRes;
    for (let i = 0; i <= limit; i++) {
      lastRes = await request(app).get("/ping");
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.body.error).toBe("rate_limit_exceeded");
  });
});
