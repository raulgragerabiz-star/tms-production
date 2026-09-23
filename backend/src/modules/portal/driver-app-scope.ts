// Fase 25 ("usuarios app" sub-fase 3): la App Conductor deja de tener un
// único tipo de sesión (cuenta de conductor con driverId) -- ahora también
// puede ser una sesión abierta por QR de RUTA (centro + circuito +
// transportista), sin ningún AppUser/Driver real detrás (ver
// loginWithRouteQrToken, auth.service.ts). Este fichero centraliza cómo
// driver-app.routes.ts averigua "de qué envíos/paradas puede leer o escribir
// esta sesión" para los dos casos, para no repetir la lógica de resolución
// del circuito (Fase 15: customer-zone-resolution.ts) en cada endpoint.
//
// Alcance de una sesión de QR de ruta: como DeliveryZone (circuito) no
// cuelga directamente de Route (ver comentario largo en RouteQrToken,
// schema.prisma), no hay ninguna columna que diga "esta ruta es de este
// circuito" -- se resuelve igual que ya hace el Planificador
// (resolveDeliveryZonesForPairs), mirando el cliente de cada parada de la
// ruta para el almacén de esa ruta. El diseño de "ruta primero" (Fase 18) ya
// asume que todas las paradas de una ruta comparten circuito, así que basta
// con que UNA parada resuelva al circuito del QR para dar la ruta por
// buena -- no hace falta que las paradas resuelvan TODAS al mismo circuito
// aquí (esa es una preocupación de tarifas, no de autorización).
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/utils/http-error";
import { resolveDeliveryZonesForPairs, zonePairKey } from "@/modules/customers/customer-zone-resolution";

export interface RouteQrIdentity {
  warehouseId: string;
  deliveryZoneId: string;
  carrierId: string;
  driverName: string;
  driverDni: string;
  driverPhone: string | null;
  vehiclePlate: string;
  trailerPlate: string | null;
}

export type DriverAppScope = { kind: "driver"; driverId: string } | ({ kind: "routeQr" } & RouteQrIdentity);

// No se importa JwtPayload de auth.service.ts a propósito -- evitaría una
// dependencia circular (auth.service.ts necesita stampRouteQrIdentity, más
// abajo). Se acepta la forma mínima que hace falta leer del token.
export function resolveDriverAppScope(auth: { driverId?: string | null; routeQr?: RouteQrIdentity }): DriverAppScope {
  if (auth.routeQr) return { kind: "routeQr", ...auth.routeQr };
  if (!auth.driverId) {
    // No debería ocurrir nunca -- requireDriverApp ya exige driverId o
    // routeQr. Se trata como sesión inválida en vez de romper con un `!`
    // sobre undefined en el resto de endpoints.
    throw HttpError.unauthorized("Sesión de conductor no válida");
  }
  return { kind: "driver", driverId: auth.driverId };
}

// Fragmento de `where` sobre Route, usable tanto en consultas directas de
// Shipment (a través de `route: {...}`) como de RouteStop (a través de
// `route: {...}`) -- comprueba solo lo que SÍ es una columna real (almacén y
// transportista); el circuito se comprueba aparte con
// routeBelongsToDeliveryZone, porque no es una columna.
export function scopedRouteWhereForShipmentQuery(scope: DriverAppScope) {
  return scope.kind === "driver" ? { shipment: { driverId: scope.driverId } } : { warehouseId: scope.warehouseId, shipment: { carrierId: scope.carrierId } };
}

export function scopedShipmentWhere(scope: DriverAppScope) {
  return scope.kind === "driver" ? { driverId: scope.driverId } : { carrierId: scope.carrierId, route: { warehouseId: scope.warehouseId } };
}

// true si la ruta (por sus paradas) pertenece al circuito indicado -- ver
// comentario largo al principio del fichero. Solo hace falta llamarla para
// sesiones de QR de ruta: una sesión de conductor real ya queda
// completamente acotada por driverId (columna real), no necesita este
// segundo paso.
export async function routeBelongsToDeliveryZone(routeId: string, warehouseId: string, deliveryZoneId: string): Promise<boolean> {
  const stops: { order: { customerId: string } }[] = await prisma.routeStop.findMany({
    where: { routeId },
    select: { order: { select: { customerId: true } } },
  });
  if (stops.length === 0) return false;

  const pairs = stops.map((s: { order: { customerId: string } }) => ({ customerId: s.order.customerId, warehouseId }));
  const zoneMap = await resolveDeliveryZonesForPairs(pairs);
  return pairs.some((p: { customerId: string; warehouseId: string }) => zoneMap.get(zonePairKey(p.customerId, warehouseId))?.id === deliveryZoneId);
}

// Ids de los envíos de un día concreto que pertenecen al alcance de una
// sesión de QR de ruta -- usado por GET /today-route y, al iniciar sesión,
// por stampRouteQrIdentity más abajo. `carrierId` y `route.warehouseId` son
// columnas reales (filtro barato); el circuito se resuelve una sola vez para
// todas las rutas candidatas de ese día (mismo criterio que
// routeBelongsToDeliveryZone, pero en lote).
export async function findShipmentIdsForRouteQrScope(scope: Extract<DriverAppScope, { kind: "routeQr" }>, day: Date): Promise<string[]> {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const nextDay = new Date(dayStart);
  nextDay.setDate(nextDay.getDate() + 1);

  interface Candidate {
    id: string;
    route: { stops: { order: { customerId: string } }[] };
  }

  const candidates: Candidate[] = await prisma.shipment.findMany({
    where: {
      carrierId: scope.carrierId,
      route: { warehouseId: scope.warehouseId, routeDate: { gte: dayStart, lt: nextDay } },
    },
    select: {
      id: true,
      route: { select: { stops: { select: { order: { select: { customerId: true } } } } } },
    },
  });
  if (candidates.length === 0) return [];

  const pairs = candidates.flatMap((c: Candidate) => c.route.stops.map((st) => ({ customerId: st.order.customerId, warehouseId: scope.warehouseId })));
  const zoneMap = pairs.length > 0 ? await resolveDeliveryZonesForPairs(pairs) : new Map();

  return candidates
    .filter((c: Candidate) => c.route.stops.some((st) => zoneMap.get(zonePairKey(st.order.customerId, scope.warehouseId))?.id === scope.deliveryZoneId))
    .map((c: Candidate) => c.id);
}

// Fase 25: sella los envíos de HOY que correspondan a este QR de ruta con
// los datos que la persona acaba de introducir en el formulario -- se llama
// una vez, al iniciar sesión (loginWithRouteQrToken, auth.service.ts).
// Aditivo y sin consecuencias si todavía no hay ningún envío para hoy en ese
// centro+circuito+transportista (el Planificador no ha confirmado la ruta
// todavía): no falla, simplemente no sella nada -- la próxima vez que
// alguien entre con este mismo QR (o esta misma sesión, si refresca) lo
// sellará en cuanto exista. Vuelve a sellar (sobrescribe) si ya lo había
// hecho un escaneo anterior el mismo día -- el criterio es "la última
// persona que se identificó para esta ruta hoy", coherente con que el QR es
// fijo y lo puede escanear cualquiera del transportista.
export async function stampRouteQrIdentity(scope: Extract<DriverAppScope, { kind: "routeQr" }>, day: Date = new Date()): Promise<void> {
  const shipmentIds = await findShipmentIdsForRouteQrScope(scope, day);
  if (shipmentIds.length === 0) return;

  await prisma.shipment.updateMany({
    where: { id: { in: shipmentIds } },
    data: {
      routeQrDriverName: scope.driverName,
      routeQrDriverDni: scope.driverDni,
      routeQrDriverPhone: scope.driverPhone,
      routeQrVehiclePlate: scope.vehiclePlate,
      routeQrTrailerPlate: scope.trailerPlate,
      routeQrLoggedInAt: new Date(),
    } as any,
  });
}

// Etiqueta legible para dejar constancia de "quién" en campos de texto libre
// que antes solo tenían sentido para conductores reales (Incident.reportedBy,
// ShipmentMessage.senderName) -- una sesión de QR de ruta no tiene ni email
// ni un `sub` que signifique nada para quien lo lea después en Backoffice.
export function driverAppScopeLabel(scope: DriverAppScope, fallbackSub: string, fallbackEmail: string): { reportedBy: string; senderName: string } {
  if (scope.kind === "routeQr") {
    const who = `${scope.driverName} (QR ruta, ${scope.vehiclePlate})`;
    return { reportedBy: who, senderName: who };
  }
  return { reportedBy: fallbackSub, senderName: fallbackEmail };
}
