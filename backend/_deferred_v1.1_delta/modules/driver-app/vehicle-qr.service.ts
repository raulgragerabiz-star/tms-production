import crypto from "crypto";
import { prisma } from "../../lib/prisma";

/**
 * Genera (o regenera) el token QR de un vehículo. El valor `token` es lo que
 * se codifica en el QR físico pegado al vehículo — documento v1.1 §5.1.
 */
export async function issueVehicleQrToken(vehicleId: string): Promise<string> {
  await prisma.vehicleQrToken.updateMany({
    where: { vehicleId, active: true },
    data: { active: false, revokedAt: new Date() },
  });

  const token = crypto.randomBytes(24).toString("base64url");
  await prisma.vehicleQrToken.create({
    data: { vehicleId, token, active: true },
  });

  return token;
}

/**
 * Resuelve un token escaneado a su vehicleId, validando que esté activo.
 */
export async function resolveVehicleFromQrToken(token: string) {
  const record = await prisma.vehicleQrToken.findUnique({
    where: { token },
    include: { vehicle: { include: { vehicleType: true, carrier: true } } },
  });

  if (!record || !record.active) {
    throw new Error("Token QR no válido o revocado");
  }

  return record.vehicle;
}
