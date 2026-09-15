// Fase 11: cascada total para Vehículo y Conductor -- petición de Raúl de
// poder borrar cualquier dato aunque tenga histórico real (ver comentario en
// cascade-delete-helpers.ts). Sustituye al bloqueo por "ya tiene rutas/
// envíos registrados" que existía hasta ahora en vehicles.routes.ts.
//
// Se exportan como funciones "Tx" (reciben la transacción ya abierta, no
// abren la suya propia) para poder usarse tanto sueltas -- vehicles.routes.ts
// las envuelve en su propio `prisma.$transaction` -- como anidadas dentro de
// la cascada, más grande, de borrar un Carrier entero (carrier-delete.service.ts
// borra primero todos sus vehículos/conductores llamando a estas mismas
// funciones con SU transacción).
import { Prisma } from "@prisma/client";
import { deleteShipmentCascade } from "@/lib/cascade-delete-helpers";

export async function vehicleCascadeDeleteTx(tx: Prisma.TransactionClient, vehicleId: string): Promise<void> {
  // QR de identificación y asignaciones a conductores: puro histórico
  // operativo, se borra sin más.
  await tx.vehicleQrToken.deleteMany({ where: { vehicleId } });
  await tx.vehicleDriver.deleteMany({ where: { vehicleId } });
  // DriverShift.vehicleId es opcional -- la jornada del conductor
  // (inicio/fin, GPS) se conserva, solo se desvincula el vehículo con el
  // que se hizo.
  await tx.driverShift.updateMany({ where: { vehicleId }, data: { vehicleId: null } });
  // Shipment.vehicleId es obligatorio -- cada envío que usó este vehículo se
  // borra entero (con su propia cascada: liquidación, incidencias, devoluciones).
  const shipments = await tx.shipment.findMany({ where: { vehicleId }, select: { id: true } });
  for (const s of shipments) {
    await deleteShipmentCascade(tx, s.id);
  }
  // Route.vehicleId es opcional -- la ruta se queda sin vehículo asignado,
  // no se borra por esto.
  await tx.route.updateMany({ where: { vehicleId }, data: { vehicleId: null } });
  await tx.vehicle.delete({ where: { id: vehicleId } });
}

export async function driverCascadeDeleteTx(tx: Prisma.TransactionClient, driverId: string): Promise<void> {
  // Histórico de a qué vehículo ha estado asignado -- se borra sin más.
  await tx.vehicleDriver.deleteMany({ where: { driverId } });
  // DriverShift.driverId es obligatorio -- a diferencia del vehículo, la
  // jornada (inicio/fin, GPS) SÍ desaparece con el conductor: no tiene
  // sentido sin él.
  await tx.driverShift.deleteMany({ where: { driverId } });
  // Shipment.driverId es opcional -- el envío se queda sin conductor
  // asignado, no se borra por esto.
  await tx.shipment.updateMany({ where: { driverId }, data: { driverId: null } });
  await tx.driver.delete({ where: { id: driverId } });
}
