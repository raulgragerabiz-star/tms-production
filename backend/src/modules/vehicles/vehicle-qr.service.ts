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
