// Utilidad de mantenimiento para el entorno demo.
//
// El endpoint GET /api/driver-app/today-route (backend/src/modules/portal/driver-app.routes.ts)
// busca, correctamente, el shipment del conductor autenticado cuya Route.routeDate caiga
// dentro del día de HOY. Esa es la lógica correcta y no debe debilitarse.
//
// El problema no está en el backend: la ruta/shipment/pedido demo se creó a mano en algún
// momento (probablemente desde el Backoffice) con una routeDate fija (p.ej. 2026-09-04), así
// que en cuanto pasa ese día today-route deja de encontrar nada y la Driver App muestra
// "No tienes ninguna ruta asignada para hoy.".
//
// Este script "reactiva" la última ruta demo del conductor D00000001 moviéndola al día de
// hoy, sin tocar el resto de datos (cliente, pedido, línea de pedido, parada). Es idempotente:
// se puede ejecutar cada día antes de hacer pruebas con la Driver App.
//
// Uso:
//   cd backend && npm run demo:refresh-today

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_DRIVER_TAX_ID = "D00000001";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  const driver = await prisma.driver.findUnique({ where: { taxId: DEMO_DRIVER_TAX_ID } });
  if (!driver) {
    console.error(
      `No existe ningún driver con taxId "${DEMO_DRIVER_TAX_ID}". Ejecuta antes "npm run db:seed" para crear los datos base de demo.`
    );
    process.exitCode = 1;
    return;
  }

  const shipment = await prisma.shipment.findFirst({
    where: { driverId: driver.id },
    orderBy: { route: { routeDate: "desc" } },
    include: { route: { include: { stops: true } } },
  });

  if (!shipment) {
    console.error(
      `El conductor demo (${driver.fullName}, ${driver.taxId}) no tiene ningún shipment/ruta creado todavía.\n` +
        `Este script solo reactiva una ruta demo existente; créala una vez a mano desde el Backoffice ` +
        `(pedido -> planificación -> asignar conductor/vehículo) y vuelve a ejecutar este script cuando haga falta refrescar la fecha.`
    );
    process.exitCode = 1;
    return;
  }

  const today = startOfToday();

  await prisma.$transaction(async (tx) => {
    await tx.route.update({
      where: { id: shipment.routeId },
      data: { routeDate: today },
    });

    await tx.shipment.update({
      where: { id: shipment.id },
      data: { status: "programmed", departedAt: null, finishedAt: null },
    });

    for (const stop of shipment.route.stops) {
      await tx.routeStop.update({ where: { id: stop.id }, data: { status: "pending" } });
      await tx.proofOfDelivery.deleteMany({ where: { routeStopId: stop.id } });
    }
  });

  console.log(
    `OK: ruta ${shipment.routeId} del conductor ${driver.fullName} (${driver.taxId}) movida a hoy (${today.toISOString().slice(0, 10)}).\n` +
      `Shipment ${shipment.id} -> status "programmed", ${shipment.route.stops.length} parada(s) reiniciada(s) a "pending".`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });