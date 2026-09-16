// Fase 15: resolución del circuito de reparto EFECTIVO de un cliente para un
// almacén concreto -- petición explícita de Raúl ("al seleccionar el almacén
// de salida, si cambiara el almacén pero en otro también tiene entregas ese
// cliente, figurará otra ruta distinta").
//
// Regla (ver comentario largo en el modelo CustomerDeliveryZone,
// schema.prisma):
//   1) si existe una fila CustomerDeliveryZone para (customerId, warehouseId),
//      esa gana -- es la asignación específica para ese almacén.
//   2) si no, se usa el circuito único de siempre (Customer.deliveryZoneId)
//      como valor por defecto -- ningún cliente sin overrides cambia de
//      comportamiento.
//   3) si tampoco hay circuito por defecto, el cliente sencillamente no tiene
//      circuito para ese almacén (null) -- igual que hasta ahora.
//
// Usado tanto por /routes/planner-board (columna "Ruta" de la pestaña
// Planificación) como por /optimization/:routeId/simulate (cálculo de
// `singleDeliveryZoneId` del comparador de transportistas), para que ambos
// sitios respondan siempre lo mismo ante la misma combinación cliente+almacén.
import { prisma } from "@/lib/prisma";

export interface ResolvedZone {
  id: string;
  name: string;
}

export function zonePairKey(customerId: string, warehouseId: string): string {
  return `${customerId}::${warehouseId}`;
}

export async function resolveDeliveryZonesForPairs(
  pairs: Array<{ customerId: string; warehouseId: string }>
): Promise<Map<string, ResolvedZone | null>> {
  const result = new Map<string, ResolvedZone | null>();
  if (pairs.length === 0) return result;

  const customerIds = [...new Set(pairs.map((p) => p.customerId))];

  const [overrides, customers] = await Promise.all([
    prisma.customerDeliveryZone.findMany({
      where: { customerId: { in: customerIds } },
      include: { deliveryZone: { select: { id: true, name: true } } },
    }),
    prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, deliveryZone: { select: { id: true, name: true } } },
    }),
  ]);

  const overrideMap = new Map<string, ResolvedZone>();
  for (const o of overrides) {
    overrideMap.set(zonePairKey(o.customerId, o.warehouseId), o.deliveryZone);
  }
  const defaultMap = new Map<string, ResolvedZone | null>();
  for (const c of customers) {
    defaultMap.set(c.id, c.deliveryZone ?? null);
  }

  for (const { customerId, warehouseId } of pairs) {
    const key = zonePairKey(customerId, warehouseId);
    result.set(key, overrideMap.get(key) ?? defaultMap.get(customerId) ?? null);
  }
  return result;
}
