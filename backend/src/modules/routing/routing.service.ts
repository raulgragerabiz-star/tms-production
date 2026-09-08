// Objetivo 2: cálculo de distancia/tiempo de una ruta. Todavía no hay
// integrado un proveedor de rutas real (Google/HERE/OSRM) -- eso implica una
// API key y, en el caso de Google, requiere facturación. Mientras tanto se usa
// distancia en línea recta (haversine) entre almacén y paradas, en su orden de
// secuencia, corregida con un factor de sinuosidad y una velocidad media
// configurable. Es una aproximación, no la distancia real por carretera, pero
// funciona ya mismo sin coste ni dependencias externas.
//
// Migración futura a un proveedor gratuito (ej. OpenRouteService, que da una
// API key gratuita con límite diario, perfil "driving-hgv" para camiones):
// sustituir el cuerpo de `estimateRoute` por una llamada a su API de
// Directions, sin tocar la firma de la función ni el código que la usa.

import { prisma } from "@/lib/prisma";

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

// points[0] debe ser el origen (almacén); el resto, las paradas en orden de
// secuencia. Puntos sin lat/lng ya vienen filtrados por quien llama.
export async function estimateRoute(points: RoutePoint[]): Promise<RouteEstimate> {
  if (points.length < 2) {
    return { distanceKm: 0, durationMin: 0 };
  }

  let straightLineKm = 0;
  for (let i = 0; i < points.length - 1; i++) {
    straightLineKm += haversineKm(points[i], points[i + 1]);
  }

  const distanceKm = straightLineKm * ROAD_WINDING_FACTOR;
  const durationMin = (distanceKm / AVERAGE_SPEED_KMH) * 60;

  return { distanceKm, durationMin };
}

export interface VehicleTypeSuggestion {
  vehicleType: { id: string; name: string; maxWeightKg: number; maxPallets: number };
  fitsWeight: boolean;
  fitsPallets: boolean;
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
  const fitsWeight = params.totalWeightKg <= maxWeightKg;
  const fitsPallets = params.totalPallets <= maxPallets;

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

  return {
    vehicleType: { id: zone.vehicleType.id, name: zone.vehicleType.name, maxWeightKg, maxPallets },
    fitsWeight,
    fitsPallets,
    reasons,
  };
}
