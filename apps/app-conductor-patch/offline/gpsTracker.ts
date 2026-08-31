// apps/app-conductor/src/offline/gpsTracker.ts
//
// Captura continua de posición mientras la app está activa en ruta
// (documento 14-app-conductor-TMS.md, §GPS). Cada ping se agrupa en un
// buffer local y se vuelca a la cola offline (offlineQueue.ts) cada
// BATCH_INTERVAL_MS — nunca se llama a la API directamente desde aquí,
// así el mismo código funciona igual con o sin cobertura.

import { enqueueAction } from "./offlineQueue";

const BATCH_INTERVAL_MS = 15_000; // (config) — envía un lote cada 15s de captura
const MIN_DISTANCE_METERS = 20; // (config) — descarta pings casi idénticos (vehículo parado)

interface BufferedPing {
  clientEventId: string;
  lat: number;
  lng: number;
  occurredAt: string;
}

let watchId: number | null = null;
let buffer: BufferedPing[] = [];
let flushIntervalId: ReturnType<typeof setInterval> | null = null;
let currentShipmentId: string | null = null;

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function startGpsTracking(shipmentId: string) {
  if (watchId != null) stopGpsTracking(); // evita trackers duplicados si se reentra

  currentShipmentId = shipmentId;
  buffer = [];

  if (!("geolocation" in navigator)) {
    console.warn("[gps] Geolocation API no disponible en este dispositivo");
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const last = buffer[buffer.length - 1];

      if (last && haversineMeters(last, { lat: latitude, lng: longitude }) < MIN_DISTANCE_METERS) {
        return; // vehículo prácticamente parado, no merece la pena otro ping
      }

      buffer.push({
        clientEventId: crypto.randomUUID(),
        lat: latitude,
        lng: longitude,
        occurredAt: new Date(position.timestamp).toISOString(),
      });
    },
    (err) => console.warn("[gps] Error de geolocalización", err),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );

  flushIntervalId = setInterval(flushGpsBuffer, BATCH_INTERVAL_MS);
}

export function stopGpsTracking() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (flushIntervalId != null) {
    clearInterval(flushIntervalId);
    flushIntervalId = null;
  }
  flushGpsBuffer(); // vuelca lo que quedara pendiente antes de parar
  currentShipmentId = null;
}

function flushGpsBuffer() {
  if (buffer.length === 0 || !currentShipmentId) return;

  const pings = buffer;
  buffer = [];

  enqueueAction({
    type: "gps_batch",
    method: "POST",
    url: `/driver-app/shipments/${currentShipmentId}/tracking-events`,
    body: { pings },
  });
}
