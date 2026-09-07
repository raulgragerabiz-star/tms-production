import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "@/app";
import { resetDatabase, seedMinimalFixtures } from "./helpers";

const app = createApp();

describe("Planificación (/api/routes, /api/optimization)", () => {
  let token: string;
  let warehouseId: string;
  let customerId: string;
  let deliveryPointId: string;
  let productId: string;
  let carrierId: string;
  let orderId: string;
  let secondOrderId: string;

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

    const carrierRes = await request(app)
      .post("/api/carriers")
      .set("Authorization", `Bearer ${token}`)
      .send({ legalName: "Transportista Test", taxId: `T-${Date.now()}`, serviceType: "both" });
    carrierId = carrierRes.body.id;

    await request(app)
      .post("/api/rates/pallet")
      .set("Authorization", `Bearer ${token}`)
      .send({ carrierId, validFrom: "2025-01-01", fixedFeePerNote: 15, looseItemFee: 3, maxWeightPerPalletKg: 800 });

    const orderRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderNumber: `PED-${Date.now()}-1`,
        customerId,
        deliveryPointId,
        warehouseId,
        requestedDeliveryDate: "2026-09-01",
        serviceType: "pallet",
        lines: [{ productId, quantity: 4, unit: "UD" }],
      });
    orderId = orderRes.body.id;

    const secondOrderRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderNumber: `PED-${Date.now()}-2`,
        customerId,
        deliveryPointId,
        warehouseId,
        requestedDeliveryDate: "2026-09-01",
        serviceType: "pallet",
        lines: [{ productId, quantity: 2, unit: "UD" }],
      });
    secondOrderId = secondOrderRes.body.id;
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("crea una ruta agrupando pedidos validados y los marca como 'planned'", async () => {
    const res = await request(app)
      .post("/api/routes")
      .set("Authorization", `Bearer ${token}`)
      .send({ warehouseId, routeDate: "2026-09-01", serviceType: "pallet", orderIds: [orderId] });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.stops).toHaveLength(1);
    expect(Number(res.body.loadPlan.totalWeightKg)).toBe(100); // 4 × 25kg

    const order = await request(app).get(`/api/orders/${orderId}`).set("Authorization", `Bearer ${token}`);
    expect(order.body.status).toBe("planned");
  });

  it("rechaza crear una ruta con un pedido inexistente", async () => {
    const res = await request(app)
      .post("/api/routes")
      .set("Authorization", `Bearer ${token}`)
      .send({ warehouseId, routeDate: "2026-09-01", serviceType: "pallet", orderIds: ["00000000-0000-0000-0000-000000000000"] });

    expect(res.status).toBe(400);
  });

  it("añade una segunda parada a una ruta draft y recalcula la ocupación total", async () => {
    const created = await request(app)
      .post("/api/routes")
      .set("Authorization", `Bearer ${token}`)
      .send({ warehouseId, routeDate: "2026-09-01", serviceType: "pallet", orderIds: [orderId] });

    const res = await request(app)
      .post(`/api/routes/${created.body.id}/stops`)
      .set("Authorization", `Bearer ${token}`)
      .send({ orderId: secondOrderId });

    expect(res.status).toBe(200);
    expect(res.body.stops).toHaveLength(2);
    expect(Number(res.body.loadPlan.totalWeightKg)).toBe(150); // 100 + 50
  });

  it("el planner-board expone el pedido como pendiente hasta que se asigna a una ruta", async () => {
    const before = await request(app)
      .get("/api/routes/planner-board")
      .query({ warehouseId })
      .set("Authorization", `Bearer ${token}`);
    expect(before.body.pendingOrders.map((o: any) => o.id)).toContain(orderId);

    await request(app)
      .post("/api/routes")
      .set("Authorization", `Bearer ${token}`)
      .send({ warehouseId, routeDate: "2026-09-01", serviceType: "pallet", orderIds: [orderId] });

    const after = await request(app)
      .get("/api/routes/planner-board")
      .query({ warehouseId })
      .set("Authorization", `Bearer ${token}`);
    expect(after.body.pendingOrders.map((o: any) => o.id)).not.toContain(orderId);
  });

  it("genera comparativa de coste por transportista y permite seleccionar la ganadora", async () => {
    const route = await request(app)
      .post("/api/routes")
      .set("Authorization", `Bearer ${token}`)
      .send({ warehouseId, routeDate: "2026-09-01", serviceType: "pallet", orderIds: [orderId] });

    const sim = await request(app)
      .post(`/api/optimization/${route.body.id}/simulate`)
      .set("Authorization", `Bearer ${token}`);

    expect(sim.status).toBe(200);
    expect(sim.body.candidates.length).toBeGreaterThan(0);

    const routeAfterSim = await request(app).get(`/api/routes/${route.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(routeAfterSim.body.status).toBe("optimized");

    const bestCandidateId = sim.body.candidates[0].id;
    const select = await request(app)
      .post(`/api/optimization/${route.body.id}/select/${bestCandidateId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(select.status).toBe(200);

    const routeAfterSelect = await request(app).get(`/api/routes/${route.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(routeAfterSelect.body.status).toBe("assigned");
    expect(routeAfterSelect.body.carrierId).toBe(carrierId);
  });

  it("bloquea añadir paradas a una ruta ya confirmada por el transportista", async () => {
    const route = await request(app)
      .post("/api/routes")
      .set("Authorization", `Bearer ${token}`)
      .send({ warehouseId, routeDate: "2026-09-01", serviceType: "pallet", orderIds: [orderId] });

    await request(app)
      .patch(`/api/routes/${route.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "confirmed", carrierId });

    const res = await request(app)
      .post(`/api/routes/${route.body.id}/stops`)
      .set("Authorization", `Bearer ${token}`)
      .send({ orderId: secondOrderId });

    expect(res.status).toBe(409);
  });
});
