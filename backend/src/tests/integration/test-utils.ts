import express from "express";
import erpclaudRoutes from "../../modules/integrations/erpclaud/erpclaud.routes";
import { prisma } from "../../lib/prisma";

/**
 * App Express mínima para los tests de integración de este delta. En el
 * proyecto real, sustituir por el `buildApp()`/`createServer()` ya
 * existente (mismo patrón que el resto de Supertest ya presentes en el
 * repo) — aquí se monta solo lo necesario para no depender de módulos que
 * este delta no toca.
 */
export function buildTestApp() {
  const app = express();
  app.use(express.json());

  // Middleware de auth de test: inyecta un req.auth fijo, igual que hace
  // el helper de auth de test ya existente en el proyecto (se asume
  // `testAuthMiddleware` disponible; si no, sustituir por tu JWT de test).
  app.use((req, _res, next) => {
    req.auth = { companyId: TEST_COMPANY_ID, userType: "internal" } as any;
    next();
  });

  app.use("/api/integrations/erpclaud", erpclaudRoutes);

  // Error handler mínimo para no perder el stack en los tests.
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error(err);
    res.status(err.status ?? 500).json({ error: err.message ?? "internal_error" });
  });

  return app;
}

export const TEST_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
export const TEST_WAREHOUSE_ID = "22222222-2222-2222-2222-222222222222";
export const TEST_PRODUCT_SKU = "SKU-TEST-001";

/**
 * Seed mínimo compartido por los tests de integración de este delta:
 * company, warehouse, producto y reglas de segmentación por defecto.
 * Se ejecuta en beforeAll de cada suite y se limpia en afterAll.
 */
export async function seedBaseFixtures() {
  await prisma.company.upsert({
    where: { id: TEST_COMPANY_ID },
    update: {},
    create: { id: TEST_COMPANY_ID, name: "Test Company SA", taxId: "B00000000", active: true },
  });

  await prisma.warehouse.upsert({
    where: { id: TEST_WAREHOUSE_ID },
    update: {},
    create: {
      id: TEST_WAREHOUSE_ID,
      companyId: TEST_COMPANY_ID,
      name: "Almacén Test",
      address: "C. Test 1",
      postalCode: "28000",
      city: "Madrid",
      province: "Madrid",
      country: "ES",
      lat: 40.4,
      lng: -3.7,
      active: true,
    },
  });

  await prisma.product.upsert({
    where: { sku_companyId: { sku: TEST_PRODUCT_SKU, companyId: TEST_COMPANY_ID } as any },
    update: {},
    create: {
      companyId: TEST_COMPANY_ID,
      sku: TEST_PRODUCT_SKU,
      description: "Producto de test",
      salesUnit: "UD",
      unitsPerPallet: 40,
      grossWeightKg: 12.5,
      netWeightKg: 11,
      fullPalletWeightKg: 500,
      requiresCold: false,
      isReturnable: true,
      active: true,
    },
  });

  // Reglas de segmentación por defecto (mismos valores que la migración v1.1)
  const existingRules = await prisma.serviceSegmentationRule.count({
    where: { companyId: TEST_COMPANY_ID },
  });
  if (existingRules === 0) {
    await prisma.serviceSegmentationRule.createMany({
      data: [
        { companyId: TEST_COMPANY_ID, segment: "paqueteria", maxWeightKg: 30, maxPallets: 0, maxVolumeM3: 0.5, priority: 1 },
        { companyId: TEST_COMPANY_ID, segment: "paleteria", maxWeightKg: 800, maxPallets: 4, maxWeightPerPalletKg: 400, maxVolumeM3: 6, priority: 2 },
        { companyId: TEST_COMPANY_ID, segment: "paleteria_pesada", maxWeightKg: 3000, maxPallets: 6, maxWeightPerPalletKg: 1200, maxVolumeM3: 12, priority: 3 },
        { companyId: TEST_COMPANY_ID, segment: "gran_volumen", priority: 4 },
      ] as any,
    });
  }
}

export async function cleanupOrdersCreatedInTests() {
  await prisma.orderLine.deleteMany({
    where: { order: { companyId: TEST_COMPANY_ID, externalSourceSystem: "erpclaud" as any } },
  });
  await prisma.order.deleteMany({
    where: { companyId: TEST_COMPANY_ID, externalSourceSystem: "erpclaud" as any },
  });
}
