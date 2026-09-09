// Fase 6: recalcular la hora estimada de llegada (ETA) de las paradas
// pendientes de un envío cuando el conductor se desvía de la ruta prevista, o
// simplemente cada cierto intervalo aunque no se haya desviado (para que la
// ETA no se quede clavada en la del momento en que se planificó la ruta, por
// ejemplo por tráfico o por retrasos acumulados en paradas anteriores).
//
// Enfoque honesto y barato en llamadas a la API: la "desviación" se mide
// comparando la posición actual contra los vértices de la geometría de la
// ruta ya calculada (la misma que cachea getRoadRoute/estimateRoute -- normal
// que ya esté en cache, porque recalculateLoadPlan la pidió al crear/tocar la
// ruta), no contra un cálculo exacto de distancia punto-a-segmento -- de sobra
// para decidir "sí hace falta recalcular" sin gastar otra llamada a ORS solo
// para medir cuánto se ha desviado.
import { prisma } from "@/lib/prisma";
import { haversineKm, estimateStopEtas, RoutePoint } from "@/modules/routing/routing.service";
import { getRoadRoute, OrsNotConfiguredError } from "@/modules/routing/ors.service";
import { broadcastToShipment, broadcastToWarehouse } from "@/realtime/ws.server";

const DEVIATION_THRESHOLD_KM = 0.6;
const FORCED_RECALC_INTERVAL_MS = 10 * 60 * 1000; // "cada cierto intervalo" aunque no haya desviación
const HARD_MIN_GAP_MS = 60 * 1000; // nunca más de una vez por minuto por envío, aunque lleguen pings más seguidos

const lastRecalcAt = new Map<string, number>();

function minDistanceToPolylineKm(point: RoutePoint, polyline: RoutePoint[]): number {
  let min = Infinity;
  for (const vertex of polyline) {
    const d = haversineKm(point, vertex);
    if (d < min) min = d;
  }
  return min;
}

export async function maybeRecalculateEta(shipmentId: string, currentPos: RoutePoint): Promise<void> {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        route: {
          include: {
            warehouse: { select: { lat: true, lng: true } },
            stops: {
              where: { status: "pending" },
              orderBy: { sequence: "asc" },
              include: { order: { select: { deliveryPoint: { select: { lat: true, lng: true } } } } },
            },
          },
        },
      },
    });
    if (!shipment || shipment.route.stops.length === 0) return;

    const pendingPoints = shipment.route.stops
      .map((s) => (s.order.deliveryPoint.lat != null && s.order.deliveryPoint.lng != null ? { lat: s.order.deliveryPoint.lat, lng: s.order.deliveryPoint.lng } : null))
      .filter((p): p is RoutePoint => p !== null);
    if (pendingPoints.length === 0) return;

    const now = Date.now();
    const lastAt = lastRecalcAt.get(shipmentId) ?? 0;
    if (now - lastAt < HARD_MIN_GAP_MS) return;

    let shouldRecalc = now - lastAt > FORCED_RECALC_INTERVAL_MS;
    if (!shouldRecalc && shipment.route.warehouse.lat != null && shipment.route.warehouse.lng != null) {
      try {
        const plannedGeometry = await getRoadRoute([
          { lat: shipment.route.warehouse.lat, lng: shipment.route.warehouse.lng },
          ...pendingPoints,
        ]);
        if (plannedGeometry.geometry.length > 0) {
          const deviationKm = minDistanceToPolylineKm(currentPos, plannedGeometry.geometry);
          shouldRecalc = deviationKm > DEVIATION_THRESHOLD_KM;
        }
      } catch (err) {
        if (!(err instanceof OrsNotConfiguredError)) {
          // eslint-disable-next-line no-console
          console.warn("[eta-recalc] no se pudo comprobar la desviación, se sigue con el intervalo fijo:", (err as Error)?.message);
        }
        return; // sin geometría de referencia (p.ej. sin clave ORS) no hay nada que recalcular todavía
      }
    }
    if (!shouldRecalc) return;

    lastRecalcAt.set(shipmentId, now);

    const newEtas = await estimateStopEtas([currentPos, ...pendingPoints], new Date());
    await Promise.all(
      shipment.route.stops.map((s, idx) =>
        newEtas[idx] ? prisma.routeStop.update({ where: { id: s.id }, data: { eta: newEtas[idx] } }) : Promise.resolve()
      )
    );

    broadcastToShipment(shipmentId, "eta_recalculated", { shipmentId, updatedStops: shipment.route.stops.length });
    broadcastToWarehouse(shipment.route.warehouseId, "eta_recalculated", { shipmentId, routeId: shipment.routeId });
  } catch (err) {
    // Nunca debe romper el registro del ping GPS que la dispara -- es una
    // mejora sobre ese ping, no un requisito para que se guarde.
    // eslint-disable-next-line no-console
    console.warn("[eta-recalc] fallo recalculando ETA:", (err as Error)?.message ?? err);
  }
}
