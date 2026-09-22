// Fase 11: petición explícita de Raúl -- "quiero poder borrar cualquier dato
// desde el perfil de administrador, incluidos datos que contengan histórico
// (porque si no, todas las pruebas realizadas en este entorno van a dar
// datos irreales a posteriori)". Hasta ahora Carrier/Customer/Warehouse se
// daban de baja (soft delete) y Vehicle/Driver bloqueaban el borrado si ya
// tenían historial real -- todo ese freno de seguridad queda sustituido por
// borrado en cascada total, igual que ya se hizo para Pedidos (Fase 9) y
// Liquidaciones (Fase 10), y siempre restringido al rol Administrador
// (Fase 23: código "admin_empresa" -- ver requireRole en cada router).
//
// Este fichero reúne la única pieza de cascada que se repite en más de un
// sitio: borrar un Shipment y todo lo que depende EN EXCLUSIVA de él, para
// poder reutilizarla tanto al borrar un Carrier como al borrar un Vehicle
// (un Shipment concreto siempre cuelga de ambos a la vez -- carrierId y
// vehicleId son ambos obligatorios en Shipment). Deliberadamente NO borra ni
// la Route ni el RouteStop -- ambos siguen existiendo tras esto (la Route
// simplemente se queda sin envío ejecutado); quien llame a esto se encarga
// aparte de desvincular Route.carrierId/vehicleId (son opcionales) o de
// borrar la propia Route si corresponde (ver warehouse-delete.service.ts).
import { Prisma } from "@prisma/client";

export async function deleteShipmentCascade(tx: Prisma.TransactionClient, shipmentId: string): Promise<void> {
  // SettlementLine: se borra SOLO la línea de este envío, nunca la
  // CarrierSettlement (cabecera) entera -- esa liquidación puede tener
  // líneas de otros envíos del mismo transportista que no se están borrando.
  await tx.settlementLine.deleteMany({ where: { shipmentId } });
  // ReturnClaim cuelga del envío -- se borra la reclamación, no el ReturnItem
  // (ese pertenece al Cliente, ajeno a este borrado).
  await tx.returnClaim.deleteMany({ where: { shipmentId } });
  // Incident tiene shipmentId obligatorio (y opcionalmente routeStopId) --
  // esto cubre cualquier incidencia de este envío, esté o no ligada a una
  // parada concreta.
  await tx.incident.deleteMany({ where: { shipmentId } });
  // TrackingEvent y ShipmentMessage ya tienen onDelete: Cascade hacia
  // Shipment en el esquema -- no hace falta borrarlos a mano.
  await tx.shipment.delete({ where: { id: shipmentId } });
}
