// Objetivo 2 / Fase 6: cálculo de distancia/tiempo de una ruta.
//
// Hasta la Fase 6 no había ningún proveedor de rutas real integrado -- todo
// se calculaba con distancia en línea recta (haversine) entre almacén y
// paradas, corregida con un factor de sinuosidad y una velocidad media fija.
// Fase 6 añade OpenRouteService (ver ors.service.ts) como proveedor real:
// cuando hay una clave configurada (env.orsApiKey) y la llamada tiene éxito,
// se usa la distancia/duración/geometría reales por carretera. Si no hay
// clave, o la llamada falla por cualquier motivo (cuota agotada, sin red,
// coordenadas fuera de cobertura...), se cae automáticamente a la misma
// aproximación por línea recta de siempre -- nunca se rompe un recálculo de
// ruta por un fallo de un proveedor externo opcional.
//
// Las firmas públicas (`estimateRoute`, `estimateStopEtas`) casi no cambian:
// `estimateStopEtas` pasa a ser async (antes era síncrona) porque ahora puede
// implicar una llamada de red; el único punto que la llama
// (routes.routes.ts) ya está dentro de una función async.

import { prisma } from "@/lib/prisma";
import { getRoadRoute, OrsNotConfiguredError } from "@/modules/routing/ors.service";

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RouteEstimate {
  distanceKm: number;
  durationMin: number;
}

const AVERAGE_SPEED_KMH = 55;
// Una carretera real casi nunca es una línea recta -- factor orientativo de
// sinuosidad para no infravalorar sistemáticamente la distancia real.
const ROAD_WINDING_FACTOR = 1.3;
const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: RoutePoint, b: RoutePoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

function estimateRouteHaversine(points: RoutePoint[]): RouteEstimate {
  if (points.length < 2) return { distanceKm: 0, durationMin: 0 };
  let straightLineKm = 0;
  for (let i = 0; i < points.length - 1; i++) straightLineKm += haversineKm(points[i], points[i + 1]);
  const distanceKm = straightLineKm * ROAD_WINDING_FACTOR;
  return { distanceKm, durationMin: (distanceKm / AVERAGE_SPEED_KMH) * 60 };
}

export const STOP_SERVICE_MINUTES = 10;

function estimateStopEtasHaversine(points: RoutePoint[], startAt: Date): Date[] {
  const etas: Date[] = [];
  let cursor = new Date(startAt);
  for (let i = 0; i < points.length - 1; i++) {
    const legKm = haversineKm(points[i], points[i + 1]) * ROAD_WINDING_FACTOR;
    const legMin = (legKm / AVERAGE_SPEED_KMH) * 60;
    cursor = new Date(cursor.getTime() + legMin * 60000);
    etas.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + STOP_SERVICE_MINUTES * 60000);
  }
  return etas;
}

// points[0] debe ser el origen (almacén); el resto, las paradas en orden de
// secuencia. Puntos sin lat/lng ya vienen filtrados por quien llama.
export async function estimateRoute(points: RoutePoint[]): Promise<RouteEstimate> {
  if (points.length < 2) return { distanceKm: 0, durationMin: 0 };
  try {
    const real = await getRoadRoute(points);
    return { distanceKm: real.distanceKm, durationMin: real.durationMin };
  } catch (err) {
    logOrsFallback("estimateRoute", err);
    return estimateRouteHaversine(points);
  }
}

// Fase 5b (Planificador estilo Bringg -- vista Despacho + Gantt), extendido en
// Fase 6 con OpenRouteService: reparto de hora estimada de llegada por
// parada. Con ORS disponible, cada tramo usa su duración real por carretera
// (más el tiempo fijo de servicio tras cada parada); sin él, cae al mismo
// criterio de línea recta + sinuosidad de siempre. Devuelve un array con una
// fecha por parada (sin contar el almacén), en el mismo orden que
// `points.slice(1)`.
export async function estimateStopEtas(points: RoutePoint[], startAt: Date): Promise<Date[]> {
  if (points.length < 2) return [];
  try {
    const real = await getRoadRoute(points);
    if (real.legDurationsMin.length !== points.length - 1) {
      // La API no devolvió un tramo por cada trayecto esperado -- no es un
      // dato en el que se pueda confiar a ciegas, mejor caer a la aproximación
      // conocida que repartir horas con tramos desalineados.
      throw new Error("legDurationsMin no coincide con el número de tramos esperado");
    }
    const etas: Date[] = [];
    let cursor = new Date(startAt);
    for (const legMin of real.legDurationsMin) {
      cursor = new Date(cursor.getTime() + legMin * 60000);
      etas.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + STOP_SERVICE_MINUTES * 60000);
    }
    return etas;
  } catch (err) {
    logOrsFallback("estimateStopEtas", err);
    return estimateStopEtasHaversine(points, startAt);
  }
}

function logOrsFallback(fn: string, err: unknown) {
  if (err instanceof OrsNotConfiguredError) return; // esperado si no hay clave -- no es un error, ni se registra como tal
  // eslint-disable-next-line no-console
  console.warn(`[routing] ${fn}: OpenRouteService falló, usando aproximación por línea recta ->`, (err as Error)?.message ?? err);
}

// Fase 6: geometría real de la ruta (para pintarla en el mapa siguiendo
// carretera, en vez de líneas rectas entre paradas). No se persiste ni se
// cachea aparte: usa exactamente la misma cache por coordenadas que ya llenan
// `estimateRoute`/`estimateStopEtas` (ver ors.service.ts) -- si el Planificador
// (vista Despacho) pide la geometría de una ruta justo después de que
// `recalculateLoadPlan` la haya calculado, esta llamada ya sale de cache y no
// gasta cuota extra. Si no hay clave ORS configurada o la llamada falla,
// devuelve `null` y el mapa sencillamente no pinta esa línea -- degradación
// respetuosa, igual que el resto de esta fase.
export async function getRouteGeometry(points: RoutePoint[]): Promise<RoutePoint[] | null> {
  if (points.length < 2) return null;
  try {
    const real = await getRoadRoute(points);
    return real.geometry.length > 0 ? real.geometry : null;
  } catch {
    return null;
  }
}

export interface VehicleTypeSuggestion {
  vehicleType: { id: string; name: string; maxWeightKg: number; maxPallets: number; maxVolumeM3: number | null };
  fitsWeight: boolean;
  fitsPallets: boolean;
  fitsVolume: boolean;
  reasons: string[];
}

// Objetivo 2: sugerencia de tipo de vehículo -- busca, entre las zonas de
// influencia del almacén de la ruta, la franja de km en la que cae la
// distancia estimada, y comprueba si la carga total (peso/palés) cabe en el
// tipo de vehículo asignado a esa franja. Es solo una sugerencia: la persona
// sigue eligiendo el vehículo y conductor concretos de la lista ya filtrada.
export async function suggestVehicleType(params: {
  warehouseId: string;
  distanceKm: number;
  totalWeightKg: number;
  totalPallets: number;
  totalVolumeM3: number;
}): Promise<VehicleTypeSuggestion | null> {
  const zone = await prisma.influenceZone.findFirst({
    where: {
      warehouseId: params.warehouseId,
      kmMin: { lte: params.distanceKm },
      kmMax: { gt: params.distanceKm },
    },
    include: { vehicleType: true },
    orderBy: { kmMin: "asc" },
  });

  if (!zone) return null;

  const maxWeightKg = Number(zone.vehicleType.maxWeightKg);
  const maxPallets = zone.vehicleType.maxPallets;
  const maxVolumeM3 = zone.vehicleType.maxVolumeM3 != null ? Number(zone.vehicleType.maxVolumeM3) : null;
  const fitsWeight = params.totalWeightKg <= maxWeightKg;
  const fitsPallets = params.totalPallets <= maxPallets;
  const fitsVolume = maxVolumeM3 == null || params.totalVolumeM3 <= maxVolumeM3;

  const reasons: string[] = [];
  if (!fitsWeight) {
    reasons.push(
      `La carga (${Math.round(params.totalWeightKg)} kg) supera la capacidad del vehículo sugerido (${Math.round(maxWeightKg)} kg)`
    );
  }
  if (!fitsPallets) {
    reasons.push(
      `La carga (${params.totalPallets.toFixed(1)} palés) supera la capacidad del vehículo sugerido (${maxPallets} palés)`
    );
  }
  if (!fitsVolume && maxVolumeM3 != null) {
    reasons.push(
      `La carga (${params.totalVolumeM3.toFixed(1)} m³) supera la capacidad del vehículo sugerido (${maxVolumeM3.toFixed(1)} m³)`
    );
  }

  return {
    vehicleType: { id: zone.vehicleType.id, name: zone.vehicleType.name, maxWeightKg, maxPallets, maxVolumeM3 },
    fitsWeight,
    fitsPallets,
    fitsVolume,
    reasons,
  };
}
