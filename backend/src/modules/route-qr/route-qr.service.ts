// Fase 25 ("usuarios app" sub-fase 3): QR de RUTA -- un único QR fijo por
// combinación centro + circuito de reparto (DeliveryZone) + transportista,
// en vez de uno por vehículo/conductor (ver vehicle-qr.service.ts, que sigue
// existiendo tal cual mientras se completa la sub-fase 4 de la App
// Conductor). Se genera desde Flota y Transportistas > Rutas / Transportistas
// (dentro de cada fila circuito↔transportista) y sirve para cualquier día en que ese transportista tenga ruta
// real en ese circuito -- no depende de ninguna cuenta de conductor dada de
// alta. Mismo criterio de revocar-no-borrar que el QR de vehículo, para no
// romper un QR ya impreso hasta que se sepa que el nuevo se ha repartido.
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/utils/http-error";

interface RouteQrScope {
  companyId: string;
  warehouseId: string;
  deliveryZoneId: string;
  carrierId: string;
}

export async function issueRouteQrToken(scope: RouteQrScope): Promise<string> {
  await prisma.routeQrToken.updateMany({
    where: {
      warehouseId: scope.warehouseId,
      deliveryZoneId: scope.deliveryZoneId,
      carrierId: scope.carrierId,
      active: true,
    },
    data: { active: false, revokedAt: new Date() },
  });

  const token = crypto.randomBytes(24).toString("base64url");
  await prisma.routeQrToken.create({ data: { ...scope, token, active: true } });
  return token;
}

export async function findActiveRouteQrToken(scope: Omit<RouteQrScope, "companyId">) {
  return prisma.routeQrToken.findFirst({
    where: {
      warehouseId: scope.warehouseId,
      deliveryZoneId: scope.deliveryZoneId,
      carrierId: scope.carrierId,
      active: true,
    },
  });
}

// Usado desde el login solo-con-QR de la App Conductor (auth.service.ts,
// loginWithRouteQrToken) -- sin requireAuth, así que aquí es donde se valida
// de verdad que el token existe y está activo.
export async function resolveRouteQrToken(token: string) {
  const record = await prisma.routeQrToken.findUnique({
    where: { token },
    include: { warehouse: true, deliveryZone: true, carrier: true },
  });

  if (!record || !record.active) {
    throw HttpError.badRequest("Código QR no válido o revocado");
  }

  return record;
}
