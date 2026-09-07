import { prisma } from "../../lib/prisma";
import { classifyOrder } from "../../modules/segmentation/segmentation.service";
import { seedBaseFixtures, TEST_COMPANY_ID, TEST_WAREHOUSE_ID, TEST_PRODUCT_SKU } from "./test-utils";

describe("Segmentación end-to-end (classifyOrder contra BD real)", () => {
  let customerId: string;
  let deliveryPointId: string;

  beforeAll(async () => {
    await seedBaseFixtures();

    const customer = await prisma.customer.upsert({
      where: { companyId_businessCode: { companyId: TEST_COMPANY_ID, businessCode: "999000" } } as any,
      update: {},
      create: {
        companyId: TEST_COMPANY_ID,
        businessCode: "999000",
        legalName: "Cliente E2E Test",
        commercialName: "Cliente E2E Test",
        active: true,
      },
    });
    customerId = customer.id;

    const dp = await prisma.deliveryPoint.create({
      data: {
        customerId,
        label: "Sede principal",
        address: "Calle Test 1",
        postalCode: "28000",
        city: "Madrid",
        province: "Madrid",
        country: "ES",
        active: true,
      },
    });
    deliveryPointId = dp.id;
  });

  afterAll(async () => {
    await prisma.orderLine.deleteMany({ where: { order: { customerId } } });
    await prisma.order.deleteMany({ where: { customerId } });
    await prisma.deliveryPoint.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.$disconnect();
  });

  async function createTestOrder(opts: {
    orderNumber: string;
    quantity: number;
    createdAt: Date;
    requestedDeliveryDate: Date;
  }) {
    const product = await prisma.product.findFirstOrThrow({
      where: { companyId: TEST_COMPANY_ID, sku: TEST_PRODUCT_SKU },
    });

    const order = await prisma.order.create({
      data: {
        companyId: TEST_COMPANY_ID,
        orderNumber: opts.orderNumber,
        customerId,
        deliveryPointId,
        warehouseId: TEST_WAREHOUSE_ID,
        status: "received",
        priority: "standard",
        requestedDeliveryDate: opts.requestedDeliveryDate,
        createdAt: opts.createdAt,
        serviceType: "gran_volumen", // valor provisional, se recalcula
      },
    });

    await prisma.orderLine.create({
      data: {
        orderId: order.id,
        productId: product.id,
        quantity: opts.quantity,
        unit: "UD",
        lineWeightKg: opts.quantity * Number(product.grossWeightKg),
      },
    });

    return order;
  }

  it("clasifica un pedido pequeño (2 unidades, 25kg) como paqueteria", async () => {
    const order = await createTestOrder({
      orderNumber: "E2E-0001",
      quantity: 2,
      createdAt: new Date("2026-08-20T08:00:00Z"),
      requestedDeliveryDate: new Date("2026-08-28T08:00:00Z"),
    });

    const result = await classifyOrder(prisma, TEST_COMPANY_ID, order.id);
    expect(result.segment).toBe("paqueteria");

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.serviceType).toBe("paqueteria");
  });

  it("clasifica un pedido de 3 palés como paleteria y sugiere urgente si el plazo es corto", async () => {
    const order = await createTestOrder({
      orderNumber: "E2E-0002",
      quantity: 120, // 120 ud * 12.5kg = 1500kg -> supera paleteria(800) -> paleteria_pesada
      createdAt: new Date("2026-08-27T08:00:00Z"),
      requestedDeliveryDate: new Date("2026-08-28T08:00:00Z"), // 1 día hábil
    });

    const result = await classifyOrder(prisma, TEST_COMPANY_ID, order.id);
    expect(result.segment).toBe("paleteria_pesada");
    expect(result.suggestedUrgent).toBe(true);
  });

  it("nunca fuerza priority=urgent aunque lo sugiera (el planificador decide)", async () => {
    const order = await createTestOrder({
      orderNumber: "E2E-0003",
      quantity: 2,
      createdAt: new Date("2026-08-27T08:00:00Z"),
      requestedDeliveryDate: new Date("2026-08-28T08:00:00Z"),
    });

    await classifyOrder(prisma, TEST_COMPANY_ID, order.id);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.priority).toBe("standard"); // no se sobreescribe automáticamente
  });
});
