// Fase 8T: migración de datos para el rediseño de "Flota y Transportistas" >
// Transportistas -- pasa de una ÚNICA tarifa plana por (circuito,
// transportista) a una tarifa INDEPENDIENTE por cada tipo de vehículo que el
// transportista aporta en ese circuito (ver el comentario largo en
// schema.prisma, modelos DeliveryZoneRate / DeliveryZoneRateVehicleType).
//
// Política de migración decidida explícitamente por Raúl (pregunta de
// alcance, Fase 8T): "Copiar la tarifa actual a cada vehículo marcado" --
// para cada DeliveryZoneRate (ficha circuito+transportista) ya existente, se
// crea una fila DeliveryZoneRateVehicleType por cada tipo de vehículo que
// ese transportista tiene actualmente marcado como ofertado
// (CarrierVehicleType, los checkboxes de la pantalla), copiando literalmente
// los 4 importes de la ficha (flatFee/pricePerTon/unloadFee/
// partnerIncomePerTon) tal cual estaban. Así no se pierde ningún dato: la
// tarifa que antes aplicaba "a cualquier vehículo de ese transportista" pasa
// a aplicar, con el mismo importe, a cada uno de sus vehículos marcados --
// y a partir de ahí, cada tarifa se puede editar de forma independiente
// desde la nueva ficha.
//
// Uso (requiere que el schema ya esté migrado en la base de datos de
// destino -- `npx prisma db push`, DESPUÉS de git pull -- este script NO
// migra el schema, solo copia datos):
//
//   npx tsx src/scripts/migrate-fase8t-vehicle-rates.ts
//
// Idempotente: usa upsert por (deliveryZoneRateId, vehicleTypeId), así que
// ejecutarlo varias veces no duplica filas ni sobrescribe una tarifa que ya
// se haya editado a mano tras una ejecución anterior (si la fila ya existe,
// esta segunda ejecución no la toca -- ver comentario en el bucle).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rates = await prisma.deliveryZoneRate.findMany({
    include: {
      deliveryZone: { select: { name: true } },
      carrier: {
        select: {
          legalName: true,
          vehicleTypeOfferings: { select: { vehicleTypeId: true, vehicleType: { select: { name: true } } } },
        },
      },
      vehicleRates: { select: { vehicleTypeId: true } },
    },
  });

  console.log(`Fichas circuito+transportista encontradas: ${rates.length}`);

  let created = 0;
  let skippedAlreadyMigrated = 0;
  let warnedNoOfferings = 0;

  for (const rate of rates) {
    const label = `${rate.deliveryZone.name} / ${rate.carrier.legalName}`;

    if (rate.carrier.vehicleTypeOfferings.length === 0) {
      console.warn(
        `  ⚠ ${label}: el transportista no tiene ningún tipo de vehículo marcado -- no se puede migrar ` +
          `(la tarifa plana original queda intacta como legacy; hay que revisarlo a mano desde la nueva ficha).`
      );
      warnedNoOfferings++;
      continue;
    }

    const alreadyMigratedTypeIds = new Set(rate.vehicleRates.map((vr) => vr.vehicleTypeId));

    for (const offering of rate.carrier.vehicleTypeOfferings) {
      // Idempotente por diseño: si esta (ficha, tipo de vehículo) ya tiene
      // una fila -- de una ejecución anterior de este mismo script, o porque
      // alguien ya la creó/editó a mano desde la nueva pantalla -- no se
      // toca, para no pisar una edición manual posterior a la migración.
      if (alreadyMigratedTypeIds.has(offering.vehicleTypeId)) {
        skippedAlreadyMigrated++;
        continue;
      }
      await prisma.deliveryZoneRateVehicleType.create({
        data: {
          deliveryZoneRateId: rate.id,
          vehicleTypeId: offering.vehicleTypeId,
          flatFee: rate.flatFee,
          pricePerTon: rate.pricePerTon,
          unloadFee: rate.unloadFee,
          partnerIncomePerTon: rate.partnerIncomePerTon,
        },
      });
      created++;
      console.log(`  ✓ ${label} -> ${offering.vehicleType.name}`);
    }
  }

  console.log("");
  console.log(`Tarifas por tipo de vehículo creadas: ${created}`);
  console.log(`Ya migradas antes (sin tocar):        ${skippedAlreadyMigrated}`);
  console.log(`Transportistas sin ningún tipo marcado (revisar a mano): ${warnedNoOfferings}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
