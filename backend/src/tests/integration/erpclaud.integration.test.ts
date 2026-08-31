import request from "supertest";
import { prisma } from "../../lib/prisma";
import {
  buildTestApp,
  seedBaseFixtures,
  cleanupOrdersCreatedInTests,
  TEST_COMPANY_ID,
  TEST_PRODUCT_SKU,
} from "./test-utils";

const app = buildTestApp();

describe("POST /api/integrations/erpclaud/import-orders", () => {
  beforeAll(async () => {
    await seedBaseFixtures();
  });

  afterEach(async () => {
    await cleanupOrdersCreatedInTests();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const basePedido = {
    externalOrderId: "ERP-TEST-0001",
    socio: { codigo: "488000", nombre: "SANEAMIENTO LINARES, S.L.", nifCif: "B12345678" },
    direccionEntrega: {
      address: "Pol. Ind. Test, Nave 3",
      city: "Getafe",
      province: "Madrid",
      postalCode: "28906",
      lat: 40.28,
      lng: -3.73,
    },
    fechaCreacion: "2026-08-24T08:00:00.000Z",
    fechaPromesa: "2026-08-27T08:00:00.000Z",
    lineas: [{ sku: TEST_PRODUCT_SKU, cantidad: 10, unidad: "UD" }],
  };

  it("rechaza un payload que no cumple el contrato (400)", async () => {
    const res = await request(app)
      .post("/api/integrations/erpclaud/import-orders")
      .send({ schemaVersion: "1.0", pedidos: [{ externalOrderId: "x" }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_payload");
  });

  it("crea un pedido nuevo, resuelve el cliente y clasifica el segmento", async () => {
    const res = await request(app)
      .post("/api/integrations/erpclaud/import-orders")
      .send({ schemaVersion: "1.0", pedidos: [basePedido] });

    expect(res.status).toBe(200);
    expect(res.body.summary.ordersCreados).toBe(1);
    expect(res.body.summary.errores).toHaveLength(0);

    const order = await prisma.order.findFirst({
      where: { companyId: TEST_COMPANY_ID, externalOrderId: "ERP-TEST-0001" },
      include: { orderLines: true, customer: true },
    });

    expect(order).not.toBeNull();
    expect(order!.customer.businessCode).toBe("488000");
    expect(order!.orderLines).toHaveLength(1);

    // 10 unidades, 40 unidades/palé, 12.5kg/ud -> 125kg, 0.25 palés
    // -> por debajo del umbral de paquetería en peso (30kg) NO, 125kg > 30
    // -> cae en paletería (maxWeightKg 800, maxPallets 4)
    expect(order!.serviceType).toBe("paleteria");
  });

  it("es idempotente: reimportar el mismo externalOrderId actualiza, no duplica", async () => {
    await request(app)
      .post("/api/integrations/erpclaud/import-orders")
      .send({ schemaVersion: "1.0", pedidos: [basePedido] });

    const res2 = await request(app)
      .post("/api/integrations/erpclaud/import-orders")
      .send({
        schemaVersion: "1.0",
        pedidos: [{ ...basePedido, lineas: [{ sku: TEST_PRODUCT_SKU, cantidad: 20, unidad: "UD" }] }],
      });

    expect(res2.body.summary.ordersActualizados).toBe(1);
    expect(res2.body.summary.ordersCreados).toBe(0);

    const orders = await prisma.order.findMany({
      where: { companyId: TEST_COMPANY_ID, externalOrderId: "ERP-TEST-0001" },
    });
    expect(orders).toHaveLength(1);

    const lines = await prisma.orderLine.findMany({ where: { orderId: orders[0].id } });
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].quantity)).toBe(20);
  });

  it("registra el error por SKU en el resumen sin abortar el resto del lote", async () => {
    const goodPedido = { ...basePedido, externalOrderId: "ERP-TEST-0002" };
    const badPedido = {
      ...basePedido,
      externalOrderId: "ERP-TEST-0003",
      lineas: [{ sku: "SKU-NO-EXISTE", cantidad: 1, unidad: "UD" }],
    };

    const res = await request(app)
      .post("/api/integrations/erpclaud/import-orders")
      .send({ schemaVersion: "1.0", pedidos: [goodPedido, badPedido] });

    expect(res.status).toBe(200);
    expect(res.body.summary.ordersCreados).toBe(1);
    expect(res.body.summary.errores).toHaveLength(1);
    expect(res.body.summary.errores[0].externalOrderId).toBe("ERP-TEST-0003");

    await prisma.order.deleteMany({
      where: { companyId: TEST_COMPANY_ID, externalOrderId: { in: ["ERP-TEST-0002", "ERP-TEST-0003"] } },
    });
  });
});
