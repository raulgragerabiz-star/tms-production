// Fase 11: borrado en cascada total del Almacén -- petición de Raúl de poder
// borrar cualquier dato desde el perfil de administrador aunque tenga
// histórico real (ver comentario en cascade-delete-helpers.ts). Sustituye la
// baja lógica (active:false) que había hasta ahora.
//
// A diferencia de Carrier/Vehicle, aquí Route.warehouseId es OBLIGATORIO --
// no se puede simplemente desvincular una ruta de su almacén, hay que
// borrarla entera (con su propia cascada: paradas, plan de carga,
// simulaciones de coste y envío). Igual que en customer-delete.service.ts,
// cada Order/Route se borra en su propia transacción (reutilizando
// `deleteOrderCascade`), y el resto de datos propios del almacén se limpian
// en una transacción final.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/utils/http-error";
import { deleteOrderCascade } from "../orders/order-delete.service";
import { deleteShipmentCascade } from "@/lib/cascade-delete-helpers";

export interface WarehouseDeleteSummary {
  name: string;
  pedidosEliminados: number;
  rutasEliminadas: number;
}

export async function deleteWarehouseCascade(warehouseId: string, companyId: string): Promise<WarehouseDeleteSummary> {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, companyId },
    select: { id: true, name: true },
  });
  if (!warehouse) throw HttpError.notFound("Almacén no encontrado");

  const orders = await prisma.order.findMany({ where: { warehouseId }, select: { id: true } });
  for (const o of orders) {
    await deleteOrderCascade(o.id, companyId);
  }

  const routes = await prisma.route.findMany({ where: { warehouseId }, select: { id: true } });
  for (const r of routes) {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Paradas que pudieran quedar (caso límite: un pedido de otro almacén
      // asignado por error a esta ruta) -- el resto ya se limpió al borrar
      // los pedidos de este almacén arriba, pero esto cubre ese caso.
      const stops = await tx.routeStop.findMany({ where: { routeId: r.id }, select: { id: true } });
      const stopIds = stops.map((s: { id: string }) => s.id);
      if (stopIds.length > 0) {
        await tx.incident.deleteMany({ where: { routeStopId: { in: stopIds } } });
        await tx.proofOfDelivery.deleteMany({ where: { routeStopId: { in: stopIds } } });
        await tx.routeStop.deleteMany({ where: { id: { in: stopIds } } });
      }
      await tx.loadPlan.deleteMany({ where: { routeId: r.id } });
      await tx.costSimulation.deleteMany({ where: { routeId: r.id } });
      const shipment = await tx.shipment.findUnique({ where: { routeId: r.id }, select: { id: true } });
      if (shipment) {
        await deleteShipmentCascade(tx, shipment.id);
      }
      await tx.route.delete({ where: { id: r.id } });
    });
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.influenceZone.deleteMany({ where: { warehouseId } });
    await tx.demandForecast.deleteMany({ where: { warehouseId } });
    // DeliveryZone.warehouseId es opcional -- el circuito se conserva, solo
    // se desvincula de este almacén.
    await tx.deliveryZone.updateMany({ where: { warehouseId }, data: { warehouseId: null } });
    await tx.warehouse.delete({ where: { id: warehouseId } });
  });

  return { name: warehouse.name, pedidosEliminados: orders.length, rutasEliminadas: routes.length };
}
