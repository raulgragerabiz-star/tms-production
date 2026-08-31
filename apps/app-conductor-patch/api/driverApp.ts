// Añadir estas dos funciones al fichero ya existente `apps/app-conductor/src/api/driverApp.ts`
// (o al api client equivalente), reutilizando el mismo `apiClient` ya configurado
// con resolveApiBaseUrl().
//
// IMPORTANTE (actualización — modo offline): bindVehicleByQrToken se deja
// como llamada directa (requiere respuesta inmediata para mostrar el
// vehículo vinculado, no tiene sentido en cola). confirmShipmentLoad, en
// cambio, pasa a encolarse — es la acción típica que ocurre justo al
// arrancar el turno, a veces todavía sin cobertura en el propio almacén/
// polígono, documento 14-app-conductor-TMS.md §Modo offline.

import { apiClient } from "./client"; // cliente ya existente en la app
import { enqueueAction } from "@/offline/offlineQueue";

export async function bindVehicleByQrToken(token: string) {
  const res = await apiClient.post("/session/bind-vehicle", { token });
  return res.data as { vehicleId: string; plate: string; vehicleType: string; carrier: string };
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
