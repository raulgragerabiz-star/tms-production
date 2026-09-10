import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { HttpError } from "@/utils/http-error";
import { resolveVehicleFromQrToken, bindVehicleToDriverToday } from "@/modules/vehicles/vehicle-qr.service";

export interface JwtPayload {
  sub: string;
  companyId: string;
  email: string;
  userType: string;
  roles: string[];
  carrierId?: string | null;
  customerId?: string | null;
  driverId?: string | null;
}

export async function login(email: string, password: string) {
  const user = await prisma.appUser.findUnique({
    where: { email },
    include: { roles: { include: { role: true } } },
  });

  if (!user || !user.active) {
    throw HttpError.unauthorized("Credenciales inválidas");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw HttpError.unauthorized("Credenciales inválidas");
  }

  const roles = user.roles.map((r) => r.role.code);

  const payload: JwtPayload = {
    sub: user.id,
    companyId: user.companyId,
    email: user.email,
    userType: user.userType,
    roles,
    carrierId: user.carrierId,
    customerId: user.customerId,
    driverId: user.driverId,
  };

  const token = jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as any });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      userType: user.userType,
      roles,
      companyId: user.companyId,
      carrierId: user.carrierId,
      driverId: user.driverId,
    },
  };
}

// Fase 8k: petición explícita de Raúl -- "el QR realmente no sirve de nada
// si antes tiene que acceder con email y contraseña. la logica del qr es
// que al escanearlo desde el movil, acceda a la app de driver asociada a
// ese conductor, vehiculo y empresa de tte correspondiente". Hasta ahora el
// QR (pegado en la cabina del vehículo) solo servía para VINCULAR un
// vehículo a un conductor que YA había iniciado sesión con email/contraseña
// (POST /driver-app/session/bind-vehicle) -- inútil para un conductor que
// arranca el día sin más que su móvil y el QR físico.
//
// Este login alternativo resuelve el vehículo a partir del QR, busca qué
// conductor tiene asignado ese vehículo AHORA MISMO (VehicleDriver con
// validTo null -- la misma asignación vigente que ya se gestiona desde
// Backoffice > Flota y Transportistas > Conductores) y emite un JWT normal
// para la cuenta de App Conductor de ese conductor, sin pedir contraseña --
// la posesión del QR físico (pegado dentro del vehículo de la empresa) hace
// de credencial. Además vincula el vehículo en el mismo paso (mismo efecto
// que bind-vehicle) para que el conductor no tenga que volver a escanear.
export async function loginWithVehicleQrToken(token: string) {
  const vehicle = await resolveVehicleFromQrToken(token);

  const assignment = await prisma.vehicleDriver.findFirst({
    where: { vehicleId: vehicle.id, validTo: null },
    orderBy: { validFrom: "desc" },
  });
  if (!assignment) {
    throw HttpError.badRequest(
      "Este vehículo todavía no tiene un conductor asignado en Backoffice (Flota y Transportistas > Conductores) -- pide que te asignen antes de escanear."
    );
  }

  const user = await prisma.appUser.findFirst({
    where: { driverId: assignment.driverId, userType: "driver_app" },
    include: { roles: { include: { role: true } } },
  });
  if (!user || !user.active) {
    throw HttpError.badRequest(
      "El conductor asignado a este vehículo todavía no tiene una cuenta de App Conductor activa (Maestros > Usuarios)."
    );
  }

  const roles = user.roles.map((r: { role: { code: string } }) => r.role.code);

  const payload: JwtPayload = {
    sub: user.id,
    companyId: user.companyId,
    email: user.email,
    userType: user.userType,
    roles,
    carrierId: user.carrierId,
    customerId: user.customerId,
    driverId: user.driverId,
  };

  const jwtToken = jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as any });

  await bindVehicleToDriverToday(assignment.driverId, vehicle.id);

  return {
    token: jwtToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      userType: user.userType,
      roles,
      companyId: user.companyId,
      carrierId: user.carrierId,
      driverId: user.driverId,
    },
    vehicle: { plate: vehicle.plate, vehicleType: vehicle.vehicleType?.name, carrier: vehicle.carrier?.legalName },
  };
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}
