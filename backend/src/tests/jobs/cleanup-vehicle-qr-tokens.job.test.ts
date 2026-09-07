import { prisma } from "../../lib/prisma";
import { cleanupRevokedVehicleQrTokens } from "../../jobs/cleanup-vehicle-qr-tokens.job";
import {
  seedBaseFixtures,
  TEST_COMPANY_ID,
} from "../integration/test-utils";

describe("cleanupRevokedVehicleQrTokens", () => {
  let vehicleId: string;

  beforeAll(async () => {
    await seedBaseFixtures();

    const carrier = await prisma.carrier.create({
      data: {
        companyId: TEST_COMPANY_ID,
        legalName: "Transportista Test Jobs",
        taxId: "B99999999",
        city: "Madrid",
        province: "Madrid",
        serviceType: "both",
        ownsFleet: false,
        temperatureCapability: "ambient",
        active: true,
      },
    });

    const vehicleType = await prisma.vehicleType.create({
      data: { name: "Furgón Test Jobs", maxWeightKg: 3500, maxPallets: 6, allowsExceedingPallets: false },
    });

    const vehicle = await prisma.vehicle.create({
      data: {
        carrierId: carrier.id,
        vehicleTypeId: vehicleType.id,
        plate: `TEST-${Date.now()}`,
        active: true,
      },
    });
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    await prisma.vehicleQrToken.deleteMany({ where: { vehicleId } });
    await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
    await prisma.$disconnect();
  });

  it("borra solo los tokens revocados más antiguos que el periodo de retención", async () => {
    const oldRevoked = await prisma.vehicleQrToken.create({
      data: {
        vehicleId,
        token: `old-revoked-${Date.now()}`,
        active: false,
        revokedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // hace 45 días
      },
    });

    const recentRevoked = await prisma.vehicleQrToken.create({
      data: {
        vehicleId,
        token: `recent-revoked-${Date.now()}`,
        active: false,
        revokedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // hace 2 días
      },
    });

    const activeToken = await prisma.vehicleQrToken.create({
      data: { vehicleId, token: `active-${Date.now()}`, active: true },
    });

    const result = await cleanupRevokedVehicleQrTokens(30); // retención de 30 días
    expect(result.deletedCount).toBeGreaterThanOrEqual(1);

    const remainingOld = await prisma.vehicleQrToken.findUnique({ where: { id: oldRevoked.id } });
    expect(remainingOld).toBeNull(); // borrado

    const remainingRecent = await prisma.vehicleQrToken.findUnique({ where: { id: recentRevoked.id } });
    expect(remainingRecent).not.toBeNull(); // conservado, dentro del periodo de retención

    const remainingActive = await prisma.vehicleQrToken.findUnique({ where: { id: activeToken.id } });
    expect(remainingActive).not.toBeNull(); // nunca se borra un token activo
  });

  it("es seguro ejecutarlo cuando no hay nada que borrar", async () => {
    const result = await cleanupRevokedVehicleQrTokens(9999);
    expect(result.deletedCount).toBe(0);
  });
});
