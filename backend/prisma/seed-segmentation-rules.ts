// Siembra las 4 reglas de segmentación por defecto (peso/palés que definen
// paquetería/paletería/paletería pesada/gran volumen) para TODAS las
// empresas que todavía no tengan ninguna regla activa configurada.
//
// Sin estas reglas, el clasificador de pedidos (segmentation.service.ts,
// usado por el bridge de importación ERP Claude) no tiene nada contra lo que
// comparar y cae siempre en el valor por defecto "gran_volumen" — cualquier
// pedido, sin importar su peso real, queda mal clasificado.
//
// Idempotente: una empresa que ya tenga al menos una regla activa se salta
// (no duplica ni pisa configuración ya hecha a medida). Los umbrales son los
// mismos ya documentados en el proyecto (prisma/migrations_manual/v1_1_segmentation.sql)
// y pensados como punto de partida razonable, no como valores definitivos —
// se pueden ajustar a mano en la tabla `service_segmentation_rule` según la
// operativa real de cada empresa.
//
// Uso:
//   cd backend && npm run db:seed:segmentation

import { PrismaClient, ServiceType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.company.findMany({ where: { active: true } });

  for (const company of companies) {
    const existingCount = await prisma.serviceSegmentationRule.count({
      where: { companyId: company.id, active: true },
    });
    if (existingCount > 0) {
      console.log(`- ${company.name}: ya tiene ${existingCount} regla(s) activa(s), no se toca.`);
      continue;
    }

    await prisma.serviceSegmentationRule.createMany({
      data: [
        {
          companyId: company.id,
          segment: ServiceType.paqueteria,
          maxWeightKg: 30,
          maxPallets: 0,
          priority: 1,
          active: true,
        },
        {
          companyId: company.id,
          segment: ServiceType.paleteria,
          maxWeightKg: 800,
          maxPallets: 4,
          maxWeightPerPalletKg: 400,
          priority: 2,
          active: true,
        },
        {
          companyId: company.id,
          segment: ServiceType.paleteria_pesada,
          maxWeightKg: 3000,
          maxPallets: 6,
          maxWeightPerPalletKg: 1500,
          priority: 3,
          active: true,
        },
        {
          companyId: company.id,
          segment: ServiceType.gran_volumen,
          priority: 4,
          active: true,
        },
      ],
    });

    console.log(`- ${company.name}: 4 reglas por defecto creadas.`);
  }

  console.log("OK: siembra de reglas de segmentación completada.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });