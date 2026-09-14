// QR de conductor + vehículo: genera y resuelve el token que se codifica en
// el QR físico pegado al vehículo. El conductor lo escanea desde la App al
// iniciar turno para vincular ese vehículo concreto, útil cuando no tiene uno
// fijo asignado ese día (ver driver-app.routes.ts, POST /session/bind-vehicle).
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/utils/http-error";

// Revoca (no borra) cualquier token activo anterior antes de emitir uno
// nuevo -- así un QR ya impreso deja de funcionar en cuanto se regenera, sin
// perder el histórico de qué tokens tuvo el vehículo.
export async function issueVehicleQrToken(vehicleId: string): Promise<string> {
  await prisma.vehicleQrToken.updateMany({
    where: { vehicleId, active: true },
    data: { active: false, revokedAt: new Date() },
  });

  const token = crypto.randomBytes(24).toString("base64url");
  await prisma.vehicleQrToken.create({ data: { vehicleId, token, active: true } });
  return token;
}

export async function resolveVehicleFromQrToken(token: string) {
  const record = await prisma.vehicleQrToken.findUnique({
    where: { token },
    include: { vehicle: { include: { vehicleType: true, carrier: true } } },
  });

  if (!record || !record.active) {
    throw HttpError.badRequest("Token QR no válido o revocado");
  }

  return record.vehicle;
}

// Fase 8k: extraído tal cual del handler POST /driver-app/session/bind-vehicle
// (driver-app.routes.ts) para poder reutilizarlo también desde el nuevo login
// solo-con-QR (auth.service.ts, loginWithVehicleQrToken) -- mismo efecto
// exacto, sin duplicar lógica: actualiza el vehículo del envío de hoy (si lo
// hay) y de la jornada abierta (si la hay).
//
// Fase 8Y: `findFirst` + `update` cambiado a `updateMany` -- mismo bug de
// fondo que el de driver-app.routes.ts GET /today-route (Shipment.driverId
// no es único, un conductor puede tener más de un envío el mismo día). Con
// `findFirst` solo se actualizaba UNO de ellos al escanear el QR del
// vehículo; el resto se quedaba con el vehículo antiguo/vacío.
export async function bindVehicleToDriverToday(driverId: string, vehicleId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  await prisma.shipment.updateMany({
    where: { driverId, route: { routeDate: { gte: today, lt: tomorrow } } },
    data: { vehicleId },
  });

  const openShift = await prisma.driverShift.findFirst({ where: { driverId, endedAt: null } });
  if (openShift) {
    await prisma.driverShift.update({ where: { id: openShift.id }, data: { vehicleId } });
  }
}
