// Funciones del cliente de API para QR de ruta + jornada.
//
// Fase 25 ("usuarios app" sub-fase 3): sustituye del todo al login por QR de
// vehículo + email/contraseña (loginWithVehicleQr / bindVehicleByQrToken,
// que usaban VehicleQrToken) -- petición explícita de Raúl. La App Conductor
// entra ahora escaneando el QR fijo de un circuito de reparto (centro +
// circuito + transportista) y rellenando un formulario de identificación.
// Los endpoints antiguos (`/auth/driver-qr-login`,
// `/driver-app/session/bind-vehicle`) se dejan tal cual en el backend por si
// hiciera falta consultarlos más adelante, pero esta app ya no los llama.
//
// confirmShipmentLoad queda sin usar por ahora: el checkpoint de "carga" ya
// se cubre desde TodayRoutePage con el botón "He cargado el vehículo"
// (POST /driver-app/shipments/:id/status), añadido más tarde en el Objetivo
// 3. Se deja aquí por si en el futuro conviene un checkpoint de carga
// independiente del estado general del envío, pero no tiene endpoint montado
// -- no llamar todavía.

import { apiClient, api } from "./client"; // cliente ya existente en la app
import { enqueueAction } from "@/offline/offlineQueue";
import type { RouteQrSession } from "@/store/auth-store";

export interface RouteQrLoginForm {
  driverName: string;
  driverDni: string;
  driverPhone?: string;
  vehiclePlate: string;
  trailerPlate?: string;
}

// Fase 25: login solo-con-QR de RUTA -- usa `api` en vez de `apiClient` a
// propósito: en este momento no hay ningún token todavía (es indiferente
// cuál se use, son la misma instancia -- ver client.ts -- pero así queda más
// claro en el nombre que es una llamada "pre-login").
export async function loginWithRouteQr(token: string, form: RouteQrLoginForm) {
  const res = await api.post("/auth/route-qr-login", { token, ...form });
  return res.data as {
    token: string;
    routeQr: {
      warehouseId: string;
      deliveryZoneId: string;
      carrierId: string;
      driverName: string;
      driverDni: string;
      driverPhone: string | null;
      vehiclePlate: string;
      trailerPlate: string | null;
    };
    warehouse: { id: string; name: string };
    deliveryZone: { id: string; name: string };
    carrier: { id: string; legalName: string };
  };
}

// Arma el objeto de sesión (auth-store.ts) a partir de la respuesta de
// loginWithRouteQr -- centralizado aquí para no repetir el mapeo en
// LoginPage.tsx.
export function routeQrSessionFromLoginResponse(res: Awaited<ReturnType<typeof loginWithRouteQr>>): RouteQrSession {
  return {
    driverName: res.routeQr.driverName,
    driverDni: res.routeQr.driverDni,
    driverPhone: res.routeQr.driverPhone,
    vehiclePlate: res.routeQr.vehiclePlate,
    trailerPlate: res.routeQr.trailerPlate,
    warehouse: res.warehouse,
    deliveryZone: res.deliveryZone,
    carrier: res.carrier,
  };
}

// Jornada (inicio/fin de turno) -- QR de conductor + jornada.
export async function getCurrentShift() {
  const res = await apiClient.get("/driver-app/shifts/current");
  return res.data as { shift: { id: string; startedAt: string; vehicle: { plate: string } | null } | null };
}

export async function startShift(coords?: { lat: number; lng: number }) {
  const res = await apiClient.post("/driver-app/shifts/start", coords ?? {});
  return res.data as { shift: { id: string; startedAt: string; vehicle: { plate: string } | null } };
}

export async function endShift(coords?: { lat: number; lng: number }) {
  const res = await apiClient.post("/driver-app/shifts/end", coords ?? {});
  return res.data as { shift: { id: string; startedAt: string; endedAt: string } };
}

// Fase 8L (rediseño App Conductor): nota de conductor y escáner de códigos
// por parada -- llamadas directas (no en cola offline) porque son acciones
// puntuales del propio conductor, no fichajes críticos como el GPS.
export async function saveStopNotes(stopId: string, note: string) {
  const res = await apiClient.patch(`/driver-app/stops/${stopId}/notes`, { note });
  return res.data as { driverNotes: string | null };
}

export async function scanStopCode(stopId: string, code: string) {
  const res = await apiClient.post(`/driver-app/stops/${stopId}/scan`, { code });
  return res.data as { scannedCodes: { code: string; scannedAt: string }[] };
}

export function confirmShipmentLoad(shipmentId: string) {
  // Ya no es async-directo: se encola y se resuelve en segundo plano.
  // La UI debe optimistically asumir éxito y dejar que el OfflineBanner
  // informe si algo falla más tarde (ver TodayRoutePage.patch.md).
  enqueueAction({
    type: "confirm_load",
    method: "POST",
    url: `/driver-app/shipments/${shipmentId}/confirm-load`,
    body: {},
  });
}
