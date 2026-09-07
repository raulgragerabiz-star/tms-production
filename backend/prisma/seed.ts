import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  const company = await prisma.company.upsert({
    where: { taxId: "B00000001" },
    update: {},
    create: { name: "Distribuidora Demo, S.L.", taxId: "B00000001", active: true },
  });

  const warehouse = await prisma.warehouse.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      companyId: company.id,
      name: "Almacén Central Getafe",
      address: "C. Trece el Lomo, 4",
      postalCode: "28906",
      city: "Getafe",
      province: "Madrid",
      country: "ES",
      lat: 40.3058,
      lng: -3.7327,
    },
  });

  // Permisos base
  const permissionCodes = [
    "orders.read", "orders.write",
    "planning.read", "planning.write",
    "rates.read", "rates.write", "rates.approve",
    "masters.read", "masters.write",
    "billing.read", "billing.write",
    "admin.users",
  ];
  const permissions = await Promise.all(
    permissionCodes.map((code) => prisma.permission.upsert({ where: { code }, update: {}, create: { code } }))
  );

  const roleDefs: { code: string; name: string; permissionCodes: string[] }[] = [
    { code: "admin_empresa", name: "Administrador de empresa", permissionCodes: permissionCodes },
    { code: "planificador", name: "Planificador", permissionCodes: ["orders.read", "orders.write", "planning.read", "planning.write", "rates.read", "masters.read"] },
    { code: "gestor_flota", name: "Gestor de flota", permissionCodes: ["masters.read", "masters.write", "rates.read", "rates.write"] },
    { code: "administracion", name: "Administración / Facturación", permissionCodes: ["billing.read", "billing.write", "orders.read", "planning.read", "rates.read", "masters.read"] },
  ];

  const roles: Record<string, string> = {};
  for (const def of roleDefs) {
    const role = await prisma.role.upsert({
      where: { code: def.code },
      update: {},
      create: { code: def.code, name: def.name, companyId: company.id },
    });
    roles[def.code] = role.id;
    for (const pCode of def.permissionCodes) {
      const permission = permissions.find((p) => p.code === pCode)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  const adminPasswordHash = await bcrypt.hash("Admin1234!", 10);
  const adminUser = await prisma.appUser.upsert({
    where: { email: "admin@tms.local" },
    update: {},
    create: {
      companyId: company.id,
      email: "admin@tms.local",
      passwordHash: adminPasswordHash,
      fullName: "Administrador TMS",
      userType: "internal",
      active: true,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: roles["admin_empresa"] } },
    update: {},
    create: { userId: adminUser.id, roleId: roles["admin_empresa"] },
  });

  const planificadorHash = await bcrypt.hash("Plan1234!", 10);
  const planificadorUser = await prisma.appUser.upsert({
    where: { email: "planificador@tms.local" },
    update: {},
    create: {
      companyId: company.id,
      email: "planificador@tms.local",
      passwordHash: planificadorHash,
      fullName: "Operador de Expediciones",
      userType: "internal",
      active: true,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: planificadorUser.id, roleId: roles["planificador"] } },
    update: {},
    create: { userId: planificadorUser.id, roleId: roles["planificador"] },
  });

  // Tipos de vehículo (Fase 1, §3.5 — 6 tipos reales)
  const vehicleTypeDefs = [
    { name: "Trailer", maxWeightKg: 24000, maxPallets: 33, allowsExceedingPallets: false },
    { name: "Rígido 18t", maxWeightKg: 12000, maxPallets: 16, allowsExceedingPallets: true },
    { name: "Rígido 12t", maxWeightKg: 7500, maxPallets: 10, allowsExceedingPallets: true },
    { name: "Rígido 7,5t", maxWeightKg: 4500, maxPallets: 8, allowsExceedingPallets: false },
    { name: "Ligero 3,5t", maxWeightKg: 1500, maxPallets: 3, allowsExceedingPallets: false },
    { name: "Furgón grande", maxWeightKg: 1000, maxPallets: 2, allowsExceedingPallets: false },
  ];
  const vehicleTypes = [];
  for (const vt of vehicleTypeDefs) {
    const existing = await prisma.vehicleType.findFirst({ where: { name: vt.name } });
    vehicleTypes.push(existing ?? (await prisma.vehicleType.create({ data: vt })));
  }

  // 6 transportistas reales (Fase 1, §3.4)
  const carrierDefs = [
    "Transportes Bigmat Norte, S.L.",
    "Transportes Levante Express, S.A.",
    "Logística del Sur, S.L.U.",
    "Transportes Castilla, S.L.",
    "Grupo Paletero Ibérico, S.A.",
    "Transportes Rápidos Getafe, S.L.",
  ];

  let firstCarrier: { id: string } | null = null;
  let firstVehicle: { id: string } | null = null;

  for (let i = 0; i < carrierDefs.length; i++) {
    const taxId = `A${(10000000 + i).toString()}`;
    const carrier = await prisma.carrier.upsert({
      where: { taxId },
      update: {},
      create: {
        companyId: company.id,
        legalName: carrierDefs[i],
        taxId,
        city: "Madrid",
        province: "Madrid",
        serviceType: "both",
        ownsFleet: false,
        temperatureCapability: "ambient",
        active: true,
      },
    });
    if (i === 0) firstCarrier = carrier;

    // Vehículo concreto por transportista
    const vt = vehicleTypes[i % vehicleTypes.length];
    const vehicle = await prisma.vehicle.upsert({
      where: { plate: `${1000 + i}ABC` },
      update: {},
      create: {
        carrierId: carrier.id,
        vehicleTypeId: vt.id,
        plate: `${1000 + i}ABC`,
        workingTemperature: "ambient",
      },
    });
    if (i === 0) firstVehicle = vehicle;

    // Tarifa camión completo vigente
    const existingFT = await prisma.fullTruckRate.findFirst({ where: { carrierId: carrier.id } });
    if (!existingFT) {
      await prisma.fullTruckRate.create({
        data: {
          carrierId: carrier.id,
          validFrom: new Date("2025-01-01"),
          validTo: null,
          includedKm: 100 + i * 10,
          extraStopFee: 25 + i * 2,
          extraKmFee: 0.9 + i * 0.05,
          currency: "EUR",
        },
      });
    }

    // Tarifa paletería vigente
    const existingPR = await prisma.palletRate.findFirst({ where: { carrierId: carrier.id } });
    if (!existingPR) {
      await prisma.palletRate.create({
        data: {
          carrierId: carrier.id,
          validFrom: new Date("2025-01-01"),
          validTo: null,
          fixedFeePerNote: 15 + i,
          looseItemFee: 3 + i * 0.5,
          maxWeightPerPalletKg: 800,
          currency: "EUR",
        },
      });
    }
  }

  // Usuarios demo de Portal Transportista y App Conductor (Fases 12-13), scoped al primer
  // transportista/vehículo sembrados arriba.
  if (firstCarrier) {
    const carrierPortalHash = await bcrypt.hash("Carrier1234!", 10);
    await prisma.appUser.upsert({
      where: { email: "transportista@tms.local" },
      update: {},
      create: {
        companyId: company.id,
        email: "transportista@tms.local",
        passwordHash: carrierPortalHash,
        fullName: "Portal Transportista Demo",
        userType: "carrier_portal",
        carrierId: firstCarrier.id,
        active: true,
      },
    });

    const driver = await prisma.driver.upsert({
      where: { taxId: "D00000001" },
      update: {},
      create: { carrierId: firstCarrier.id, fullName: "Conductor Demo", taxId: "D00000001", phone: "600000000", active: true },
    });

    if (firstVehicle) {
      const existingAssignment = await prisma.vehicleDriver.findFirst({ where: { vehicleId: firstVehicle.id, driverId: driver.id } });
      if (!existingAssignment) {
        await prisma.vehicleDriver.create({ data: { vehicleId: firstVehicle.id, driverId: driver.id, validFrom: new Date("2025-01-01") } });
      }
    }

    const driverAppHash = await bcrypt.hash("Driver1234!", 10);
    await prisma.appUser.upsert({
      where: { email: "conductor@tms.local" },
      update: {},
      create: {
        companyId: company.id,
        email: "conductor@tms.local",
        passwordHash: driverAppHash,
        fullName: "Conductor Demo",
        userType: "driver_app",
        carrierId: firstCarrier.id,
        driverId: driver.id,
        active: true,
      },
    });
  }

  // Un cliente y un punto de entrega de ejemplo (según Fase 1: código de negocio real)
  const customer = await prisma.customer.upsert({
    where: { companyId_businessCode: { companyId: company.id, businessCode: "488000" } },
    update: {},
    create: {
      companyId: company.id,
      businessCode: "488000",
      legalName: "SANEAMIENTO LINARES, S.L.",
      commercialName: "Saneamiento Linares",
      active: true,
    },
  });

  const existingDp = await prisma.deliveryPoint.findFirst({ where: { customerId: customer.id } });
  if (!existingDp) {
    await prisma.deliveryPoint.create({
      data: {
        customerId: customer.id,
        label: "Almacén principal",
        address: "Polígono Industrial Los Ángeles, Nave 12",
        postalCode: "23700",
        city: "Linares",
        province: "Jaén",
        country: "ES",
        lat: 38.0959,
        lng: -3.6355,
        exchangesPallets: true,
      },
    });
  }

  // Usuario demo del Portal Cliente (falta en el seed original: driver_app y
  // carrier_portal ya tenían usuario demo, customer_portal no, así que nunca
  // se podía hacer login en apps/customer-portal con datos de seed).
  const customerPortalHash = await bcrypt.hash("Customer1234!", 10);
  await prisma.appUser.upsert({
    where: { email: "cliente@tms.local" },
    update: {},
    create: {
      companyId: company.id,
      email: "cliente@tms.local",
      passwordHash: customerPortalHash,
      fullName: "Portal Cliente Demo",
      userType: "customer_portal",
      customerId: customer.id,
      active: true,
    },
  });

  // Clientes/puntos de entrega adicionales con coordenadas en el área de Madrid,
  // para poder ver varios marcadores reales en el mapa del planificador (Fase 5, Pantalla 4).
  const extraCustomers = [
    { code: "500010", name: "BIGMAT STORES, S.L.U", city: "Fuenlabrada", lat: 40.2818, lng: -3.7940 },
    { code: "500011", name: "FERRETERÍA CENTRAL MADRID, S.L.", city: "Madrid", lat: 40.4168, lng: -3.7038 },
    { code: "500012", name: "CONSTRUCCIONES PINTO, S.A.", city: "Pinto", lat: 40.2415, lng: -3.6996 },
    { code: "500013", name: "MATERIALES PARLA, S.L.", city: "Parla", lat: 40.2372, lng: -3.7674 },
  ];
  for (const ec of extraCustomers) {
    const c = await prisma.customer.upsert({
      where: { companyId_businessCode: { companyId: company.id, businessCode: ec.code } },
      update: {},
      create: { companyId: company.id, businessCode: ec.code, legalName: ec.name, active: true },
    });
    const existingEcDp = await prisma.deliveryPoint.findFirst({ where: { customerId: c.id } });
    if (!existingEcDp) {
      await prisma.deliveryPoint.create({
        data: {
          customerId: c.id,
          label: "Punto de entrega principal",
          address: `Polígono Industrial, ${ec.city}`,
          city: ec.city,
          province: "Madrid",
          country: "ES",
          lat: ec.lat,
          lng: ec.lng,
          exchangesPallets: true,
        },
      });
    }
  }

  // Un producto de ejemplo
  const existingProduct = await prisma.product.findFirst({ where: { sku: "DEMO-0001" } });
  if (!existingProduct) {
    await prisma.product.create({
      data: {
        companyId: company.id,
        sku: "DEMO-0001",
        description: "Cemento gris saco 25kg",
        salesUnit: "UD",
        unitsPerPallet: 48,
        grossWeightKg: 25,
        netWeightKg: 24.5,
        fullPalletWeightKg: 1220,
        requiresCold: false,
        isReturnable: true,
        carriageNoteDescription: "Cemento gris CEM II 25kg",
      },
    });
  }

  console.log("Seed completado.");
  console.log("Usuario admin: admin@tms.local / Admin1234!");
  console.log("Usuario planificador: planificador@tms.local / Plan1234!");
  console.log("Portal Transportista: transportista@tms.local / Carrier1234!");
  console.log("App Conductor: conductor@tms.local / Driver1234!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });