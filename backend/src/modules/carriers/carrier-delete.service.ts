// Fase 11: borrado en cascada total del Transportista -- petición de Raúl de
// poder borrar cualquier dato desde el perfil de administrador aunque tenga
// histórico real (ver comentario en cascade-delete-helpers.ts). Sustituye la
// baja lógica (deletedAt+active:false) que había hasta ahora.
//
// Orden de borrado (de hijo a padre, para no chocar con ninguna FK):
// Shipments de este transportista (con su propia cascada) -> Liquidaciones
// -> tarifas (CostSimulation/CustomerRate/FullTruckRate/PalletRate/
// RateSurcharge/ZoneRate) -> tarifas por circuito (DeliveryZoneRate +
// sus filas por tipo de vehículo) -> capacidad declarada (CarrierVehicleType)
// -> Vehículos y Conductores propios (cascada completa cada uno) -> Rutas
// (se desvinculan, no se borran: Route.carrierId es opcional) -> cuentas de
// Portal Transportista (AppUser.carrierId no es una FK real -- se
// desactivan/desvinculan a mano para no dejarlas apuntando a un id muerto).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/utils/http-error";
import { deleteShipmentCascade } from "@/lib/cascade-delete-helpers";
import { vehicleCascadeDeleteTx, driverCascadeDeleteTx } from "../vehicles/vehicle-delete.service";

export interface CarrierDeleteSummary {
  legalName: string;
  vehiculosEliminados: number;
  conductoresEliminados: number;
}

export async function deleteCarrierCascade(carrierId: string, companyId: string): Promise<CarrierDeleteSummary> {
  const carrier = await prisma.carrier.findFirst({
    where: { id: carrierId, companyId },
    select: { id: true, legalName: true },
  });
  if (!carrier) throw HttpError.notFound("Transportista no encontrado");

  return prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const shipments = await tx.shipment.findMany({ where: { carrierId }, select: { id: true } });
      for (const s of shipments) {
        await deleteShipmentCascade(tx, s.id);
      }

      // CarrierSettlement -- sus SettlementLine ya tienen onDelete: Cascade.
      await tx.carrierSettlement.deleteMany({ where: { carrierId } });

      // Tarifas propias del transportista.
      await tx.costSimulation.deleteMany({ where: { carrierId } });
      await tx.customerRate.deleteMany({ where: { carrierId } });
      await tx.fullTruckRate.deleteMany({ where: { carrierId } });
      await tx.palletRate.deleteMany({ where: { carrierId } });
      await tx.rateSurcharge.deleteMany({ where: { carrierId } });
      await tx.zoneRate.deleteMany({ where: { carrierId } });

      // Tarifas por circuito (DeliveryZoneRate) -- primero sus filas por
      // tipo de vehículo, luego la cabecera.
      const zoneRates = await tx.deliveryZoneRate.findMany({ where: { carrierId }, select: { id: true } });
      const zoneRateIds = zoneRates.map((r: { id: string }) => r.id);
      if (zoneRateIds.length > 0) {
        await tx.deliveryZoneRateVehicleType.deleteMany({ where: { deliveryZoneRateId: { in: zoneRateIds } } });
        await tx.deliveryZoneRate.deleteMany({ where: { id: { in: zoneRateIds } } });
      }

      // Capacidad declarada (checkboxes de tipo de vehículo).
      await tx.carrierVehicleType.deleteMany({ where: { carrierId } });

      // Vehículos y conductores propios -- cascada completa cada uno.
      const vehicles = await tx.vehicle.findMany({ where: { carrierId }, select: { id: true } });
      for (const v of vehicles) {
        await vehicleCascadeDeleteTx(tx, v.id);
      }
      const drivers = await tx.driver.findMany({ where: { carrierId }, select: { id: true } });
      for (const d of drivers) {
        await driverCascadeDeleteTx(tx, d.id);
      }

      // Route.carrierId es opcional -- la ruta se queda sin transportista
      // asignado, no se borra por esto (puede tener paradas de pedidos
      // reales que siguen necesitando planificarse).
      await tx.route.updateMany({ where: { carrierId }, data: { carrierId: null } });

      // AppUser.carrierId (login de Portal Transportista) no es una FK real
      // en el esquema -- sin esto quedaría apuntando a un id ya inexistente.
      // Se desactiva y desvincula en vez de borrar la cuenta de usuario.
      await tx.appUser.updateMany({ where: { carrierId }, data: { active: false, carrierId: null } });

      await tx.carrier.delete({ where: { id: carrierId } });

      return {
        legalName: carrier.legalName,
        vehiculosEliminados: vehicles.length,
        conductoresEliminados: drivers.length,
      };
    },
    { timeout: 30000 }
  );
}
