// Fase 23: "usuarios app" -- petición explícita de Raúl. Los dos roles
// (Administrador, Planificador) se dan de alta atados a un "centro"
// (Warehouse) concreto -- ver AppUser.warehouseId (schema.prisma) y
// users.routes.ts. Este fichero centraliza el criterio de qué puede hacer
// cada usuario según su centro, para no repetir la misma lógica suelta en
// cada módulo (Almacenes, Pedidos, Rutas, Zonas...):
//
//   - LECTURA: sin restricción -- cualquier usuario interno autenticado ve
//     los datos de TODOS los centros de su empresa (decisión explícita de
//     Raúl para Administrador: "visibilidad de solo lectura" sobre el resto;
//     se aplica el mismo criterio a Planificador por coherencia, ya que solo
//     pidió expresamente restringir la EDICIÓN). Por eso no existe aquí
//     ningún "filtro de lectura" -- los endpoints GET no cambian.
//   - ESCRITURA (crear/editar/eliminar): solo dentro de su propio centro,
//     salvo que `scopeAllWarehouses` sea true (Administrador sin centro fijo
//     -- AppUser.warehouseId = null, ver comentario en schema.prisma), que
//     puede escribir en cualquiera.
//
// Un usuario SIN warehouseId Y sin ser Administrador "global" (userType
// distinto de "internal", o un internal sin rol reconocido) se trata como
// "sin centro" a efectos de escritura -- no se le bloquea aquí (eso ya lo
// hacen los `requireRole` existentes para las pantallas de Maestros), pero
// si un futuro endpoint solo protegido por este helper lo usa, un usuario
// sin centro no podría escribir en ninguno -- comportamiento conservador a
// propósito.
import { Request } from "express";
import { HttpError } from "@/utils/http-error";

export interface WarehouseScope {
  scopeAllWarehouses: boolean;
  warehouseId: string | null;
}

export function getWarehouseScope(req: Request): WarehouseScope {
  const warehouseId = req.auth?.warehouseId ?? null;
  // Solo el rol Administrador ("admin_empresa") puede quedar sin centro fijo
  // y que eso signifique "todos" -- ver comentario en schema.prisma. Un
  // Planificador sin warehouseId (no debería darse, users.routes.ts lo
  // exige al crear/editar) NO se trata como global, por prudencia.
  const isAdmin = !!req.auth?.roles?.includes("admin_empresa");
  return {
    scopeAllWarehouses: isAdmin && warehouseId == null,
    warehouseId,
  };
}

// Lanza 403 si el centro del recurso (resourceWarehouseId) no coincide con
// el centro del usuario y el usuario no tiene alcance global. Se usa justo
// antes de crear/editar/eliminar un recurso que pertenece a un almacén
// concreto (Warehouse, Order, Route, DeliveryZone, InfluenceZone...).
export function assertWarehouseWriteAccess(
  scope: WarehouseScope,
  resourceWarehouseId: string | null | undefined,
  label = "este centro"
) {
  if (scope.scopeAllWarehouses) return;
  if (!resourceWarehouseId || resourceWarehouseId !== scope.warehouseId) {
    throw HttpError.forbidden(
      `No tienes permiso para modificar datos de ${label} -- perteneces a otro centro. Contacta con un administrador si necesitas este cambio.`
    );
  }
}
