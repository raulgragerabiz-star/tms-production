// Diagnóstico puntual: por qué un pedido sigue clasificando como "gran_volumen"
// aunque ya existan reglas de segmentación. Imprime las reglas activas de la
// empresa, los datos reales del producto usado en el pedido de prueba, y
// reproduce a mano el cálculo de peso/palés que hace classifyOrder().
//
// Uso: cd backend && npx tsx prisma/debug-segmentation.ts <orderNumber>
// Ejemplo: npx tsx prisma/debug-segmentation.ts ERPC-ERP-PRUEBA-0001

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const orderNumber = process.argv[2];
  if (!orderNumber) {
    console.error("Uso: npx tsx prisma/debug-segmentation.ts <orderNumber>");
    process.exitCode = 1;
    return;
  }

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: { lines: { include: { product: true } } },
  });

  if (!order) {
    console.error(`No existe ningún pedido con orderNumber "${orderNumber}".`);
    process.exitCode = 1;
    return;
  }

  console.log(`Pedido: ${order.orderNumber} | companyId: ${order.companyId} | serviceType actual: ${order.serviceType}`);

  const rules = await prisma.serviceSegmentationRule.findMany({
    where: { companyId: order.companyId },
    orderBy: { priority: "asc" },
  });

  console.log(`\nReglas de segmentación para esta empresa (${rules.length} en total, activas o no):`);
  for (const r of rules) {
    console.log(
      `  [prioridad ${r.priority}] ${r.segment} | activa=${r.active} | maxWeightKg=${r.maxWeightKg} | maxPallets=${r.maxPallets} | maxWeightPerPalletKg=${r.maxWeightPerPalletKg}`
    );
  }

  let totalWeightKg = 0;
  let totalPallets = 0;
  let maxWeightPerPalletKg = 0;

  console.log(`\nLíneas del pedido (${order.lines.length}):`);
  for (const line of order.lines) {
    const weight = Number(line.lineWeightKg ?? 0);
    totalWeightKg += weight;
    const unitsPerPallet = line.product.unitsPerPallet ?? 1;
    const palletsForLine = unitsPerPallet > 0 ? Number(line.quantity) / unitsPerPallet : 0;
    totalPallets += palletsForLine;
    const fullPalletWeight = Number(line.product.fullPalletWeightKg ?? 0);
    if (fullPalletWeight > maxWeightPerPalletKg) maxWeightPerPalletKg = fullPalletWeight;

    console.log(
      `  - ${line.product.sku}: cantidad=${line.quantity} | unitsPerPallet=${line.product.unitsPerPallet} | fullPalletWeightKg=${line.product.fullPalletWeightKg} | lineWeightKg=${line.lineWeightKg} -> palés línea=${palletsForLine.toFixed(3)}`
    );
  }

  console.log(
    `\nAgregado del pedido: totalWeightKg=${totalWeightKg} | totalPallets=${totalPallets.toFixed(3)} | maxWeightPerPalletKg=${maxWeightPerPalletKg}`
  );

  console.log(`\nEvaluación regla por regla (activas, orden de prioridad):`);
  for (const r of rules.filter((r) => r.active).sort((a, b) => a.priority - b.priority)) {
    const maxWeightKg = r.maxWeightKg ? Number(r.maxWeightKg) : null;
    const maxWeightPerPalletKgRule = r.maxWeightPerPalletKg ? Number(r.maxWeightPerPalletKg) : null;
    const okWeight = maxWeightKg == null || totalWeightKg <= maxWeightKg;
    const okPallets = r.maxPallets == null || totalPallets <= r.maxPallets;
    const okWeightPerPallet =
      maxWeightPerPalletKgRule == null || maxWeightPerPalletKg === 0 || maxWeightPerPalletKg <= maxWeightPerPalletKgRule;
    const gana = okWeight && okPallets && okWeightPerPallet;
    console.log(
      `  ${r.segment}: peso ${okWeight ? "OK" : "FALLA"} (${totalWeightKg} vs max ${maxWeightKg}) | palés ${okPallets ? "OK" : "FALLA"} (${totalPallets.toFixed(3)} vs max ${r.maxPallets}) | peso/palé ${okWeightPerPallet ? "OK" : "FALLA"} (${maxWeightPerPalletKg} vs max ${maxWeightPerPalletKgRule}) -> ${gana ? "GANA ESTA REGLA" : "sigue evaluando"}`
    );
    if (gana) break;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });