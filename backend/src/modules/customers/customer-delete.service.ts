// Fase 11: borrado en cascada total del Cliente -- petición de Raúl de poder
// borrar cualquier dato desde el perfil de administrador aunque tenga
// histórico real (ver comentario en cascade-delete-helpers.ts). Sustituye la
// baja lógica que había hasta ahora ("nunca se borra físicamente un maestro
// referenciado por pedidos históricos").
//
// Reutiliza `deleteOrderCascade` (ya escrito y probado en la Fase 9) para
// cada pedido del cliente -- cada uno se borra en su propia transacción,
// igual que ya hace `wipeAllOrders`: no hace falta una transacción global
// gigante, y si algo falla a mitad los pedidos ya borrados siguen borrados,
// que es lo que se quiere de una limpieza. El resto de datos propios del
// cliente (facturas, tarifas, devoluciones, puntos de entrega) sí se borran
// en una única transacción al final, una vez ya no hay ningún pedido que
// dependa de ellos.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/utils/http-error";
import { deleteOrderCascade } from "../orders/order-delete.service";

export interface CustomerDeleteSummary {
  legalName: string;
  pedidosEliminados: number;
}

export async function deleteCustomerCascade(customerId: string, companyId: string): Promise<CustomerDeleteSummary> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, companyId },
    select: { id: true, legalName: true },
  });
  if (!customer) throw HttpError.notFound("Cliente no encontrado");

  const orders = await prisma.order.findMany({ where: { customerId }, select: { id: true } });
  for (const o of orders) {
    await deleteOrderCascade(o.id, companyId);
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // CustomerInvoice.customerId no tiene @relation declarada en el esquema
    // (columna real pero sin FK exigida) -- deleteOrderCascade ya limpia las
    // facturas ligadas a orderId, esto cubre además cualquier factura suelta
    // (orderId nulo) que solo lleve el id de este cliente.
    await tx.customerInvoice.deleteMany({ where: { customerId } });
    await tx.customerRate.deleteMany({ where: { customerId } });

    const returnItems = await tx.returnItem.findMany({ where: { customerId }, select: { id: true } });
    const returnItemIds = returnItems.map((r: { id: string }) => r.id);
    if (returnItemIds.length > 0) {
      await tx.returnClaim.deleteMany({ where: { returnItemId: { in: returnItemIds } } });
      await tx.returnItem.deleteMany({ where: { id: { in: returnItemIds } } });
    }

    // Ya no hay ningún Order que exija estos DeliveryPoint (Order.deliveryPointId
    // es obligatorio) -- se pueden borrar sin problema.
    await tx.deliveryPoint.deleteMany({ where: { customerId } });

    // AppUser.customerId (login de Portal Cliente) no es una FK real -- se
    // desactiva y desvincula en vez de borrar la cuenta.
    await tx.appUser.updateMany({ where: { customerId }, data: { active: false, customerId: null } });

    await tx.customer.delete({ where: { id: customerId } });
  });

  return { legalName: customer.legalName, pedidosEliminados: orders.length };
}
