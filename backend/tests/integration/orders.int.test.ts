import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "@/app";
import { prisma } from "@/lib/prisma";
import { resetDatabase, seedMinimalFixtures } from "./helpers";

const app = createApp();

describe("Pedidos (/api/orders)", () => {
  let token: string;
  let warehouseId: string;
  let customerId: string;
  let deliveryPointId: string;
  let productId: string;

  beforeEach(async () => {
    await resetDatabase();
    const fixtures = await seedMinimalFixtures(request(app));
    token = fixtures.adminToken;
    warehouseId = fixtures.warehouseId;

    const customerRes = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ businessCode: "488000", legalName: "Cliente Test" });
    customerId = customerRes.body.id;

    const dpRes = await request(app)
      .post("/api/delivery-points")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, address: "Calle Falsa 123", city: "Madrid" });
    deliveryPointId = dpRes.body.id;

    const productRes = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sku: "TEST-0001",
        description: "Producto de test",
        salesUnit: "UD",
        unitsPerPallet: 40,
        grossWeightKg: 25,
        fullPalletWeightKg: 1000,
      });
    productId = productRes.body.id;
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("crea un pedido y calcula el peso de línea en UD (cantidad × peso bruto unitario)", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderNumber: "PED-0001",
        customerId,
        deliveryPointId,
        warehouseId,
        requestedDeliveryDate: "2026-09-01",
        lines: [{ productId, quantity: 10, unit: "UD" }],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("validated");
    expect(Number(res.body.lines[0].lineWeightKg)).toBe(250); // 10 × 25kg
  });

  it("calcula el peso de línea en PAL usando el peso de palé lleno", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderNumber: "PED-0002",
        customerId,
        deliveryPointId,
        warehouseId,
        requestedDeliveryDate: "2026-09-01",
        lines: [{ productId, quantity: 2, unit: "PAL" }],
      });

    expect(res.status).toBe(201);
    expect(Number(res.body.lines[0].lineWeightKg)).toBe(2000); // 2 × 1000kg
  });

  it("rechaza un pedido con un producto inexistente en catálogo", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderNumber: "PED-0003",
        customerId,
        deliveryPointId,
        warehouseId,
        requestedDeliveryDate: "2026-09-01",
        lines: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: 1, unit: "UD" }],
      });

    expect(res.status).toBe(400);
  });

  it("rechaza un punto de entrega que no pertenece al cliente indicado", async () => {
    const otherCustomer = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ businessCode: "999999", legalName: "Otro cliente" });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderNumber: "PED-0004",
        customerId: otherCustomer.body.id,
        deliveryPointId, // pertenece al customerId original, no a otherCustomer
        warehouseId,
        requestedDeliveryDate: "2026-09-01",
        lines: [{ productId, quantity: 1, unit: "UD" }],
      });

    expect(res.status).toBe(404);
  });

  it("respeta la máquina de estados: no permite saltar de 'validated' a 'delivered' directamente", async () => {
    const created = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderNumber: "PED-0005",
        customerId,
        deliveryPointId,
        warehouseId,
        requestedDeliveryDate: "2026-09-01",
        lines: [{ productId, quantity: 1, unit: "UD" }],
      });

    const badTransition = await request(app)
      .patch(`/api/orders/${created.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "delivered" });
    expect(badTransition.status).toBe(400);

    const goodTransition = await request(app)
      .patch(`/api/orders/${created.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "planned" });
    expect(goodTransition.status).toBe(200);
    expect(goodTransition.body.status).toBe("planned");
  });
});
