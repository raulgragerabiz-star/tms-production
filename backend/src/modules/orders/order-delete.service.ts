// Petición de Raúl: poder eliminar pedidos desde el listado -- tanto uno
// suelto ("para hacer correcciones") como de golpe ("eliminar todo lo que se
// esta haciendo ahora para las pruebas del sistema"), igual que ya existe
// para Productos (`wipeProductCatalog`).
//
// A diferencia de Producto (donde un artículo con pedidos reales se
// DESACTIVA en vez de borrarse, para no perder histórico), aquí Raúl pidió
// explícitamente borrado EN CASCADA TOTAL: si el pedido ya tiene una parada
// de ruta, envío, documento o valoración generados, se borran también --
// esta acción no tiene vuelta atrás, y así se explica en la confirmación que
// pide el Backoffice antes de llamar a este servicio.
//
// Alcance del borrado en cascada -- IMPORTANTE, para no llevarse por delante
// datos de OTROS pedidos: solo se borra lo que pertenece EN EXCLUSIVA a este
// pedido (su propia parada de ruta, sus propias incidencias/POD de esa
// parada, sus documentos, su valoración, su factura). Nunca se borra la
// Ruta ni el Envío en sí (`Route`/`Shipment`) aunque esta fuera su única
// parada -- esos son contenedores que pueden llevar paradas de otros
// pedidos, y su gestión (rutas vacías, etc.) es un problema aparte, no algo
// que este borrado deba decidir por su cuenta.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/utils/http-error";

export interface OrderDeleteSummary {
  orderNumber: string;
  routeStopsEliminadas: number;
  documentosEliminados: number;
  facturasDesvinculadas: number;
}

export async function deleteOrderCascade(orderId: string, companyId: string): Promise<OrderDeleteSummary> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, companyId },
    select: { id: true, orderNumber: true },
  });
  if (!order) throw HttpError.notFound("Pedido no encontrado");

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const stops = await tx.routeStop.findMany({ where: { orderId }, select: { id: true } });
    const stopIds = stops.map((s: { id: string }) => s.id);

    if (stopIds.length > 0) {
      await tx.incident.deleteMany({ where: { routeStopId: { in: stopIds } } });
      await tx.proofOfDelivery.deleteMany({ where: { routeStopId: { in: stopIds } } });
      await tx.routeStop.deleteMany({ where: { id: { in: stopIds } } });
    }

    const { count: documentosEliminados } = await tx.orderDocument.deleteMany({ where: { orderId } });
    await tx.deliveryFeedback.deleteMany({ where: { orderId } });

    // La factura (CustomerInvoice) tiene `orderId` opcional -- se borra
    // también (cascada total pedida por Raúl) en vez de solo desvincularla,
    // ya que sin el pedido detrás deja de tener ningún dato real que
    // facturar.
    const { count: facturasDesvinculadas } = await tx.customerInvoice.deleteMany({ where: { orderId } });

    // `OrderLine` ya tiene onDelete: Cascade hacia Order en el esquema --
    // basta con borrar el pedido para que sus líneas desaparezcan solas.
    await tx.order.delete({ where: { id: orderId } });

    return {
      orderNumber: order.orderNumber,
      routeStopsEliminadas: stopIds.length,
      documentosEliminados,
      facturasDesvinculadas,
    };
  });
}

export interface OrdersWipeSummary {
  pedidosEliminados: number;
}

// "Limpiar pedidos de prueba" -- mismo espíritu que "Vaciar catálogo" de
// Productos, pero sin la distinción eliminar/desactivar: aquí SIEMPRE es
// borrado en cascada total (ver comentario de `deleteOrderCascade`), sobre
// TODOS los pedidos de la empresa. Reutiliza `deleteOrderCascade` pedido a
// pedido dentro de una única función -- no hace falta una transacción global
// (sería enorme y no aporta nada aquí: si falla a mitad, los pedidos ya
// borrados siguen borrados, que es justo lo que se quiere de una limpieza).
export async function wipeAllOrders(companyId: string): Promise<OrdersWipeSummary> {
  const orders = await prisma.order.findMany({ where: { companyId }, select: { id: true } });
  for (const o of orders) {
    await deleteOrderCascade(o.id, companyId);
  }
  return { pedidosEliminados: orders.length };
}
