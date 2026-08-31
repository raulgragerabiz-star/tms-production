import { prisma } from "../../lib/prisma";
import { broadcastPositionUpdate } from "../../realtime/socket-server";
import { getEstimatedSpeedKmh } from "../intelligence/eta-prediction.service";

export interface IncomingGpsPing {
  clientEventId: string; // UUID generado en el dispositivo — clave de idempotencia
  lat: number;
  lng: number;
  occurredAt: string; // ISO — timestamp real de captura en el dispositivo, no de llegada al server
  routeStopId?: string | null; // si el ping coincide con una llegada/salida de parada
  eventType?: "gps_ping" | "stop_arrival" | "stop_departure";
}

export interface IngestGpsBatchResult {
  accepted: number;
  duplicates: number;
  shipmentId: string;
}

/**
 * Ingesta en lote de eventos GPS. Diseñado para el modo offline de la App
 * Conductor (documento 14-app-conductor-TMS.md, §Modo offline): el
 * dispositivo acumula pings localmente sin cobertura y los envía en un
 * único POST al recuperar conexión — este servicio debe ser capaz de
 * aceptar decenas de eventos a la vez sin duplicarlos si el lote se
 * reintenta (fallo de red a mitad de sync).
 *
 * Idempotencia: `clientEventId` es un UUID generado en el dispositivo en
 * el momento de captura (no en el momento de envío), así que reenviar el
 * mismo lote dos veces no crea tracking_event duplicados — se resuelve
 * con un índice único (shipment_id, client_event_id) a nivel de BD.
 */
export async function ingestGpsBatch(
  shipmentId: string,
  driverId: string,
  pings: IncomingGpsPing[]
): Promise<IngestGpsBatchResult> {
  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, driverId },
    include: { route: { include: { warehouse: true } }, vehicle: true, carrier: true },
  });

  if (!shipment) {
    throw new Error("shipment_not_found_for_driver");
  }

  let accepted = 0;
  let duplicates = 0;

  // Orden cronológico antes de persistir, por si el dispositivo los envía
  // desordenados (buffer local sin garantía de orden de flush).
  const sorted = [...pings].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  );

  // ----------------------------------------------------------------------
  // OPTIMIZACIÓN: un único `createMany` con `skipDuplicates` en vez de un
  // `create` por ping dentro de un bucle con try/catch. Antes: un lote
  // offline de 100 pings (habitual tras recuperar cobertura) suponía 100
  // round trips a BD, cada uno con su propio manejo de la excepción
  // P2002 de unicidad. Ahora: 1 sola sentencia INSERT ... ON CONFLICT DO
  // NOTHING, sea cual sea el tamaño del lote. `createMany` no lanza en
  // los duplicados (los ignora), así que `duplicates` se deriva por
  // diferencia en vez de contarse uno a uno.
  // ----------------------------------------------------------------------
  const result = await prisma.trackingEvent.createMany({
    data: sorted.map((ping) => ({
      shipmentId,
      eventType: ping.eventType ?? "gps_ping",
      lat: ping.lat,
      lng: ping.lng,
      payload: { clientEventId: ping.clientEventId, routeStopId: ping.routeStopId ?? null },
      occurredAt: new Date(ping.occurredAt),
      clientEventId: ping.clientEventId,
    })),
    skipDuplicates: true,
  });

  accepted = result.count;
  duplicates = sorted.length - result.count;

  // Solo se difunde en vivo la posición MÁS RECIENTE del lote (no cada
  // ping histórico) para no saturar el canal de tiempo real — el resto
  // queda persistido para el histórico/KPIs pero no genera un evento de
  // socket por cada uno.
  const latest = sorted[sorted.length - 1];
  if (latest && shipment.route.warehouse) {
    broadcastPositionUpdate(shipment.route.warehouseId, {
      shipmentId: shipment.id,
      vehicleId: shipment.vehicleId,
      carrierName: shipment.carrier.legalName,
      lat: latest.lat,
      lng: latest.lng,
      occurredAt: latest.occurredAt,
      nextStop: await computeNextStopEta(shipmentId),
    });
  }

  return { accepted, duplicates, shipmentId };
}

/**
 * ETA de la próxima parada pendiente. Reutiliza distancia Haversine (mismo
 * enfoque ya adoptado para la secuenciación tras sustituir Google Directions
 * por Leaflet/OSM, ver apps/backoffice-patch/PlannerMap.tsx) para la
 * distancia, y desde esta pasada usa la velocidad CALIBRADA por
 * transportista/provincia/hora (eta-prediction.service.ts) en vez de un
 * valor fijo — con degradación automática al valor fijo si no hay
 * histórico suficiente. Documento 16-inteligencia-artificial-TMS.md,
 * "Predicción de ETA".
 */
async function computeNextStopEta(
  shipmentId: string
): Promise<{ routeStopId: string; etaMinutes: number | null; etaSource?: string } | null> {
  const nextStop = await prisma.routeStop.findFirst({
    where: { route: { shipment: { id: shipmentId } }, status: "pending" },
    orderBy: { sequence: "asc" },
    include: {
      order: { include: { deliveryPoint: true } },
      route: { include: { shipment: { include: { carrier: true } } } },
    },
  });

  if (!nextStop) return null;

  // Estimación simple: si no hay última posición reciente, no se calcula
  // ETA (mejor no mostrar nada que mostrar un dato inventado).
  const lastPing = await prisma.trackingEvent.findFirst({
    where: { shipmentId, eventType: "gps_ping" },
    orderBy: { occurredAt: "desc" },
  });

  if (!lastPing || !nextStop.order.deliveryPoint.lat || !nextStop.order.deliveryPoint.lng) {
    return { routeStopId: nextStop.id, etaMinutes: null };
  }

  const distanceKm = haversineKm(
    { lat: Number(lastPing.lat), lng: Number(lastPing.lng) },
    { lat: Number(nextStop.order.deliveryPoint.lat), lng: Number(nextStop.order.deliveryPoint.lng) }
  );

  const speedEstimate = await getEstimatedSpeedKmh(
    nextStop.route.companyId,
    nextStop.route.shipment!.carrierId,
    nextStop.order.deliveryPoint.province,
    new Date()
  );

  const etaMinutes = Math.round((distanceKm / speedEstimate.speedKmh) * 60);

  return { routeStopId: nextStop.id, etaMinutes, etaSource: speedEstimate.source };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
