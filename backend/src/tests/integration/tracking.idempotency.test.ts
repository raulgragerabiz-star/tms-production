import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { ingestGpsBatch } from "../../modules/tracking/tracking.service";
import { seedBaseFixtures, TEST_COMPANY_ID, TEST_WAREHOUSE_ID } from "../integration/test-utils";

describe("ingestGpsBatch — idempotencia (modo offline)", () => {
  let shipmentId: string;
  let driverId: string;

  beforeAll(async () => {
    await seedBaseFixtures();

    const carrier = await prisma.carrier.create({
      data: {
        companyId: TEST_COMPANY_ID, legalName: "Carrier Tracking Test", taxId: "B88888888",
        city: "Madrid", province: "Madrid", serviceType: "both", ownsFleet: false,
        temperatureCapability: "ambient", active: true,
      },
    });
    const vehicleType = await prisma.vehicleType.create({
      data: { name: "Tipo Tracking Test", maxWeightKg: 3500, maxPallets: 6, allowsExceedingPallets: false },
    });
    const vehicle = await prisma.vehicle.create({
      data: { carrierId: carrier.id, vehicleTypeId: vehicleType.id, plate: `TRK-${Date.now()}`, active: true },
    });
    const driver = await prisma.driver.create({
      data: { carrierId: carrier.id, fullName: "Conductor Test", taxId: `T${Date.now()}`, active: true },
    });
    driverId = driver.id;

    const company = { id: TEST_COMPANY_ID };
    const route = await prisma.route.create({
      data: {
        companyId: company.id, warehouseId: TEST_WAREHOUSE_ID, routeDate: new Date(),
        status: "in_progress", serviceType: "paleteria" as any, carrierId: carrier.id, vehicleId: vehicle.id,
      },
    });
    const shipment = await prisma.shipment.create({
      data: {
        routeId: route.id, carrierId: carrier.id, vehicleId: vehicle.id, driverId,
        status: "in_transit",
      },
    });
    shipmentId = shipment.id;
  });

  afterAll(async () => {
    await prisma.trackingEvent.deleteMany({ where: { shipmentId } });
    await prisma.shipment.deleteMany({ where: { id: shipmentId } });
    await prisma.$disconnect();
  });

  it("acepta un lote nuevo por completo", async () => {
    const pings = [
      { clientEventId: randomUUID(), lat: 40.28, lng: -3.73, occurredAt: new Date().toISOString() },
      { clientEventId: randomUUID(), lat: 40.29, lng: -3.72, occurredAt: new Date().toISOString() },
    ];

    const result = await ingestGpsBatch(shipmentId, driverId, pings);
    expect(result.accepted).toBe(2);
    expect(result.duplicates).toBe(0);
  });

  it("no duplica si el mismo lote se reenvía (fallo de red a mitad de sync)", async () => {
    const pings = [
      { clientEventId: randomUUID(), lat: 40.30, lng: -3.71, occurredAt: new Date().toISOString() },
      { clientEventId: randomUUID(), lat: 40.31, lng: -3.70, occurredAt: new Date().toISOString() },
    ];

    const first = await ingestGpsBatch(shipmentId, driverId, pings);
    expect(first.accepted).toBe(2);

    // Reintento exacto del mismo lote (mismos clientEventId)
    const retry = await ingestGpsBatch(shipmentId, driverId, pings);
    expect(retry.accepted).toBe(0);
    expect(retry.duplicates).toBe(2);

    const stored = await prisma.trackingEvent.count({
      where: { shipmentId, clientEventId: { in: pings.map((p) => p.clientEventId) } },
    });
    expect(stored).toBe(2); // no 4
  });

  it("maneja lotes parcialmente duplicados (reintento tras fallo a mitad de envío)", async () => {
    const alreadySent = { clientEventId: randomUUID(), lat: 40.32, lng: -3.69, occurredAt: new Date().toISOString() };
    const newOne = { clientEventId: randomUUID(), lat: 40.33, lng: -3.68, occurredAt: new Date().toISOString() };

    await ingestGpsBatch(shipmentId, driverId, [alreadySent]);
    const result = await ingestGpsBatch(shipmentId, driverId, [alreadySent, newOne]);

    expect(result.accepted).toBe(1);
    expect(result.duplicates).toBe(1);
  });
});
