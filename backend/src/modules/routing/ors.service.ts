// Fase 6: cliente de OpenRouteService (ORS) -- geocodificación, cálculo de
// rutas reales por carretera y optimización (motor VROOM tal cual lo expone
// ORS bajo su propia API, sin necesidad de auto-alojar nada).
//
// Documentado tal y como lo publica ORS (developer.openrouteservice.org) en el
// momento de escribir esto; como esta integración no se ha podido probar
// contra una clave real desde este entorno (sin acceso a la clave de Raúl,
// que vive solo en su .env), cualquier llamada real está envuelta en manejo
// de errores defensivo en quien la usa (routing.service.ts): si algo no
// encaja exactamente con lo documentado, el sistema cae a la aproximación por
// línea recta que ya existía, nunca se rompe una petición por esto.
//
// Límite de la capa gratuita de ORS (aprox., por clave): 2000 peticiones/día
// de Directions, 40/min; 1000/día de Geocoding; 500/día de Optimization con
// como mucho unos pocos vehículos/trabajos por petición. Por eso TODAS las
// llamadas de aquí pasan por la cache compartida (shared-cache.ts) antes de
// gastar cuota, y el motor de auto-planificación limita cuántos pedidos y
// vehículos manda de una vez (ver routes.routes.ts, POST /auto-plan).
import { env } from "@/config/env";
import { getOrLoadShared } from "@/lib/shared-cache";

const ORS_BASE_URL = "https://api.openrouteservice.org";
const REQUEST_TIMEOUT_MS = 8000;

export class OrsNotConfiguredError extends Error {
  constructor() {
    super("ORS_API_KEY no está configurada");
    this.name = "OrsNotConfiguredError";
  }
}

export class OrsRequestError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OrsRequestError";
    this.status = status;
  }
}

function requireApiKey(): string {
  if (!env.orsApiKey) throw new OrsNotConfiguredError();
  return env.orsApiKey;
}

async function orsFetch(path: string, init: RequestInit): Promise<any> {
  const apiKey = requireApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${ORS_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new OrsRequestError(
        `ORS respondió ${res.status} en ${path}${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`,
        res.status
      );
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
  confidence: number;
}

// Geocodificación (Pelias vía ORS): convierte una dirección de texto en
// lat/lng. Se cachea 30 días por texto de búsqueda normalizado -- una
// dirección física no cambia de sitio, así que es seguro cachearla mucho
// tiempo y ahorrar cuota diaria.
export async function geocodeAddress(query: {
  address: string;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
}): Promise<GeocodeResult | null> {
  const text = [query.address, query.postalCode, query.city, query.province, query.country ?? "España"]
    .filter(Boolean)
    .join(", ");
  const cacheKey = `ors:geocode:${text.toLowerCase().trim()}`;

  return getOrLoadShared(cacheKey, 30 * 24 * 60 * 60 * 1000, async () => {
    const params = new URLSearchParams({ text, size: "1", "boundary.country": query.country ?? "ES" });
    const data = await orsFetch(`/geocode/search?${params.toString()}`, { method: "GET" });
    const feature = data?.features?.[0];
    if (!feature) return null;
    const [lng, lat] = feature.geometry.coordinates;
    return {
      lat,
      lng,
      label: feature.properties?.label ?? text,
      confidence: feature.properties?.confidence ?? 0,
    };
  });
}

export interface RoadRouteResult {
  distanceKm: number;
  durationMin: number;
  // Duración de cada tramo (almacén->parada1, parada1->parada2, ...) en
  // minutos, en el mismo orden que los puntos de entrada (sin contar el
  // almacén) -- así se reparte una hora de llegada real por parada sin tener
  // que volver a llamar a la API para eso.
  legDurationsMin: number[];
  // Geometría real de la ruta (siguiendo carretera, no línea recta), para
  // pintarla en el mapa. Puede tener cientos de puntos.
  geometry: RoutePoint[];
}

// Ruta real por carretera (Directions): sustituye la aproximación de línea
// recta + factor de sinuosidad quan hay clave configurada. `points[0]` debe
// ser el origen (almacén); el resto, las paradas en orden de secuencia.
// Cacheada 2 horas por secuencia exacta de coordenadas -- una ruta con las
// mismas paradas en el mismo orden no cambia en ese margen de tiempo, y así
// no se repite la llamada cada vez que se recalcula el load plan sin haber
// tocado las paradas.
export async function getRoadRoute(points: RoutePoint[]): Promise<RoadRouteResult> {
  if (points.length < 2) return { distanceKm: 0, durationMin: 0, legDurationsMin: [], geometry: [] };

  const cacheKey = `ors:route:${env.orsProfile}:${points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|")}`;

  return getOrLoadShared(cacheKey, 2 * 60 * 60 * 1000, async () => {
    const body = {
      coordinates: points.map((p) => [p.lng, p.lat]),
      instructions: false,
    };
    const data = await orsFetch(`/v2/directions/${env.orsProfile}/geojson`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const feature = data?.features?.[0];
    if (!feature) throw new OrsRequestError("Respuesta de Directions sin ruta calculable");

    const summary = feature.properties?.summary;
    const segments = feature.properties?.segments ?? [];
    const geometry: RoutePoint[] = (feature.geometry?.coordinates ?? []).map(([lng, lat]: [number, number]) => ({
      lat,
      lng,
    }));

    return {
      distanceKm: (summary?.distance ?? 0) / 1000,
      durationMin: (summary?.duration ?? 0) / 60,
      legDurationsMin: segments.map((s: { duration: number }) => s.duration / 60),
      geometry,
    };
  });
}

// --- Optimización (motor VROOM vía ORS) --------------------------------

export interface VroomVehicle {
  id: number;
  start: [number, number]; // [lng, lat]
  end: [number, number];
  capacity: number[];
  time_window?: [number, number]; // segundos desde medianoche
}

export interface VroomJob {
  id: number;
  location: [number, number]; // [lng, lat]
  service?: number; // segundos
  delivery?: number[];
  time_windows?: [number, number][];
  priority?: number; // 0-100
}

export interface VroomStep {
  type: "start" | "job" | "end";
  job?: number;
  arrival?: number;
  location?: [number, number];
}

export interface VroomRoute {
  vehicle: number;
  steps: VroomStep[];
}

export interface VroomResult {
  code: number;
  routes: VroomRoute[];
  unassigned: { id: number; reason?: string }[];
}

// Sin cache: cada llamada representa un problema de asignación distinto
// (cambian los pedidos pendientes en cuanto se planifica uno), cachearlo no
// tendría sentido. Quien llama (routes.routes.ts) es responsable de acotar el
// tamaño del problema para respetar la capa gratuita.
export async function optimizePlan(payload: { jobs: VroomJob[]; vehicles: VroomVehicle[] }): Promise<VroomResult> {
  const data = await orsFetch(`/optimization`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    code: data?.code ?? 0,
    routes: data?.routes ?? [],
    unassigned: data?.unassigned ?? [],
  };
}
