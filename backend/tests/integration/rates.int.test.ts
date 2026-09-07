import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "@/app";
import { resetDatabase, seedMinimalFixtures } from "./helpers";

const app = createApp();

describe("Tarifas (/api/rates)", () => {
  let token: string;
  let carrierId: string;

  beforeEach(async () => {
    await resetDatabase();
    const fixtures = await seedMinimalFixtures(request(app));
    token = fixtures.adminToken;

    const carrierRes = await request(app)
      .post("/api/carriers")
      .set("Authorization", `Bearer ${token}`)
      .send({ legalName: "Transportista Test", taxId: `T-${Date.now()}` });
    carrierId = carrierRes.body.id;
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("crea una tarifa de camión completo con vigencia indefinida", async () => {
    const res = await request(app)
      .post("/api/rates/full-truck")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, validFrom: "2025-01-01", includedKm: 100, extraStopFee: 25, extraKmFee: 1 });

    expect(res.status).toBe(201);
    expect(res.body.validTo).toBeNull();
  });

  it("rechaza con 409 una segunda tarifa de camión completo cuya vigencia solapa con la existente", async () => {
    await request(app)
      .post("/api/rates/full-truck")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, validFrom: "2025-01-01", validTo: "2025-12-31", includedKm: 100, extraStopFee: 25, extraKmFee: 1 });

    const res = await request(app)
      .post("/api/rates/full-truck")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, validFrom: "2025-06-01", includedKm: 120, extraStopFee: 30, extraKmFee: 1.1 });

    expect(res.status).toBe(409);
  });

  it("permite dos tarifas de camión completo con vigencias consecutivas sin solape", async () => {
    await request(app)
      .post("/api/rates/full-truck")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, validFrom: "2025-01-01", validTo: "2025-05-31", includedKm: 100, extraStopFee: 25, extraKmFee: 1 });

    const res = await request(app)
      .post("/api/rates/full-truck")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, validFrom: "2025-06-01", includedKm: 120, extraStopFee: 30, extraKmFee: 1.1 });

    expect(res.status).toBe(201);
  });

  it("crea y valida no-solape también para tarifas de paletería, de forma independiente al camión completo", async () => {
    const fullTruck = await request(app)
      .post("/api/rates/full-truck")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, validFrom: "2025-01-01", includedKm: 100, extraStopFee: 25, extraKmFee: 1 });
    expect(fullTruck.status).toBe(201);

    // Misma vigencia que la de camión completo: no debe chocar porque son tablas distintas.
    const pallet = await request(app)
      .post("/api/rates/pallet")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, validFrom: "2025-01-01", fixedFeePerNote: 15, looseItemFee: 3, maxWeightPerPalletKg: 800 });
    expect(pallet.status).toBe(201);

    const palletClash = await request(app)
      .post("/api/rates/pallet")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, validFrom: "2025-06-01", fixedFeePerNote: 16, looseItemFee: 3.5, maxWeightPerPalletKg: 800 });
    expect(palletClash.status).toBe(409);
  });

  it("simula el coste de camión completo aplicando parada adicional y km extra sobre los incluidos", async () => {
    await request(app)
      .post("/api/rates/full-truck")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, validFrom: "2025-01-01", includedKm: 100, extraStopFee: 25, extraKmFee: 2 });

    const res = await request(app)
      .post("/api/rates/simulate")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, serviceType: "full_truck", date: "2025-06-01", km: 150, stops: 3 });

    expect(res.status).toBe(200);
    // 2 paradas extra × 25 + 50km extra × 2 = 50 + 100 = 150
    expect(res.body.estimatedCost).toBe(150);
  });

  it("devuelve 404 al simular sin tarifa vigente para la fecha solicitada", async () => {
    await request(app)
      .post("/api/rates/full-truck")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, validFrom: "2025-01-01", validTo: "2025-03-31", includedKm: 100, extraStopFee: 25, extraKmFee: 1 });

    const res = await request(app)
      .post("/api/rates/simulate")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, serviceType: "full_truck", date: "2025-06-01", km: 50, stops: 1 });

    expect(res.status).toBe(404);
  });
});
