// Funciones del cliente de API para QR de conductor + vehículo y jornada.
//
// bindVehicleByQrToken se deja como llamada directa (requiere respuesta
// inmediata para mostrar el vehículo vinculado, no tiene sentido en cola).
//
// confirmShipmentLoad queda sin usar por ahora: el checkpoint de "carga" ya
// se cubre desde TodayRoutePage con el botón "He cargado el vehículo"
// (POST /driver-app/shipments/:id/status), añadido más tarde en el Objetivo
// 3. Se deja aquí por si en el futuro conviene un checkpoint de carga
// independiente del estado general del envío, pero no tiene endpoint montado
// -- no llamar todavía.

import { apiClient, api } from "./client"; // cliente ya existente en la app
import { enqueueAction } from "@/offline/offlineQueue";

export async function bindVehicleByQrToken(token: string) {
  const res = await apiClient.post("/driver-app/session/bind-vehicle", { token });
  return res.data as { vehicleId: string; plate: string; vehicleType: string; carrier: string };
}

// Fase 8k: login solo-con-QR -- a diferencia de bindVehicleByQrToken (que
// requiere ya tener sesión iniciada), esta llamada es la que arranca la
// sesión: escanear el QR del vehículo basta para entrar en la App Conductor,
// sin email/contraseña. Usa `api` en vez de `apiClient` a propósito: en este
// momento no hay ningún token todavía (es indiferente cuál se use, son la
// misma instancia -- ver client.ts -- pero así queda más claro en el nombre
// que es una llamada "pre-login").
export async function loginWithVehicleQr(token: string) {
  const res = await api.post("/auth/driver-qr-login", { token });
  return res.data as {
    token: string;
    user: { id: string; email: string; fullName: string; userType: string; driverId: string | null };
    vehicle: { plate: string; vehicleType?: string; carrier?: string };
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
