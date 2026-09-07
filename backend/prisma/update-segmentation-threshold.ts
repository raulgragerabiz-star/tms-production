// Ajuste puntual: el tope de peso-por-palé de "paleteria_pesada" (1200kg)
// sembrado por defecto en seed-segmentation-rules.ts se quedaba corto para
// productos densos reales (p. ej. "Cemento gris saco 25kg", palé completo de
// 1220kg), haciendo que cayeran siempre en "gran_volumen" sin importar la
// cantidad pedida. Se sube a 1500kg. Idempotente y afecta a todas las
// empresas que tengan la regla activa con el valor antiguo (1200) — si ya la
// ajustaste a mano a otro valor, este script no la toca.
//
// Uso: cd backend && npx tsx prisma/update-segmentation-threshold.ts

import { PrismaClient, ServiceType } from "@prisma/client";

const prisma = new PrismaClient();

const OLD_THRESHOLD = 1200;
const NEW_THRESHOLD = 1500;

async function main() {
  const result = await prisma.serviceSegmentationRule.updateMany({
    where: { segment: ServiceType.paleteria_pesada, maxWeightPerPalletKg: OLD_THRESHOLD },
    data: { maxWeightPerPalletKg: NEW_THRESHOLD },
  });

  console.log(`OK: ${result.count} regla(s) "paleteria_pesada" actualizadas de ${OLD_THRESHOLD}kg a ${NEW_THRESHOLD}kg de tope por palé.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });