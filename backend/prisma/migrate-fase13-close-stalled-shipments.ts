// Fase 13: hasta ahora nada marcaba nunca un Shipment como "finished" al
// completar/fallar/devolver su última parada (ver el fix real en
// driver-app.routes.ts y shipments.routes.ts, `/stops/:routeStopId/complete`)
// -- un envío con todas sus paradas ya resueltas se quedaba colgado en
// "programmed"/"loaded"/"in_transit" para siempre. Consecuencia real
// reportada por Raúl: Seguimiento e Inicio seguían contándolo como ruta
// activa/en tránsito, y Facturación > Informe de gasto nunca generaba su
// liquidación (exige `status: "finished"` + `finishedAt`).
//
// Este script cierra, UNA SOLA VEZ, los envíos que ya se quedaron en ese
// estado colgado antes del fix -- de aquí en adelante el propio flujo de
// completar parada se encarga solo. Idempotente: una vez cerrado, un envío
// ya no vuelve a aparecer en la consulta (deja de estar en
// programmed/loaded/in_transit).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.shipment.findMany({
    where: { status: { in: ["programmed", "loaded", "in_transit"] as any } },
    select: { id: true, routeId: true, departedAt: true },
  });

  let closed = 0;
  for (const shipment of candidates) {
    const pendingStops = await prisma.routeStop.count({
      where: { routeId: shipment.routeId, status: { notIn: ["completed", "failed", "returned"] as any } },
    });
    if (pendingStops > 0) continue; // todavía hay trabajo real pendiente, se deja tal cual

    // Fecha de finalización real: la última entrega firmada de esa ruta, si
    // hay alguna -- más honesto que "ahora mismo" para no descolocar el
    // periodo de la liquidación (Facturación agrupa por `finishedAt`). Si
    // ninguna parada llegó a entregarse (todas failed/returned), no hay POD
    // que mirar y se usa la fecha actual como mejor estimación disponible.
    const lastPod = await prisma.proofOfDelivery.findFirst({
      where: { routeStop: { routeId: shipment.routeId } },
      orderBy: { deliveredAt: "desc" },
      select: { deliveredAt: true },
    });
    const finishedAt = lastPod?.deliveredAt ?? new Date();

    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: "finished" as any,
        departedAt: shipment.departedAt ?? finishedAt,
        finishedAt,
      },
    });
    closed++;
  }

  console.log(`Envíos cerrados (todas sus paradas ya resueltas, colgados antes del fix): ${closed}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
