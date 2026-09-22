import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { HttpError } from "@/utils/http-error";
import { resolveVehicleFromQrToken, bindVehicleToDriverToday } from "@/modules/vehicles/vehicle-qr.service";
import { resolveRouteQrToken } from "@/modules/route-qr/route-qr.service";

export interface JwtPayload {
  sub: string;
  companyId: string;
  email: string;
  userType: string;
  roles: string[];
  carrierId?: string | null;
  customerId?: string | null;
  driverId?: string | null;
  // Fase 23: "centro" (Warehouse) del usuario -- ver AppUser.warehouseId
  // (schema.prisma) y warehouse-scope.ts. null = sin centro fijo (solo tiene
  // sentido para Administrador -- ver warehouse-scope.ts, ahí se interpreta
  // como acceso a todos los centros).
  warehouseId?: string | null;
  // Fase 25: sesión de la App Conductor abierta por QR de RUTA (centro +
  // circuito + transportista) en vez de por una cuenta de conductor real --
  // ver loginWithRouteQrToken más abajo. Presente SOLO en este tipo de
  // sesión; el resto de sesiones (login normal, QR de vehículo) no lo llevan.
  // `sub` en este caso no es un AppUser real (no existe ninguno) sino un
  // identificador sintético del propio RouteQrToken -- cualquier código que
  // necesite la identidad de quien escaneó debe leerla de aquí, nunca de
  // `sub`.
  routeQr?: {
    warehouseId: string;
    deliveryZoneId: string;
    carrierId: string;
    driverName: string;
    driverDni: string;
    driverPhone: string | null;
    vehiclePlate: string;
    trailerPlate: string | null;
  };
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
    warehouseId: user.warehouseId,
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
      warehouseId: user.warehouseId,
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
    warehouseId: user.warehouseId,
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
      warehouseId: user.warehouseId,
    },
    vehicle: { plate: vehicle.plate, vehicleType: vehicle.vehicleType?.name, carrier: vehicle.carrier?.legalName },
  };
}

// Fase 25 ("usuarios app" sub-fase 3): datos del formulario que rellena
// quien escanea el QR de ruta -- ver comentario en RouteQrToken
// (schema.prisma). Deliberadamente sueltos (no ligados a ningún Driver ni
// Vehicle dado de alta, decisión explícita de Raúl): quedan solo como
// identidad de esa sesión concreta, para trazabilidad de quién hizo el
// reparto.
export interface RouteQrFormInput {
  driverName: string;
  driverDni: string;
  driverPhone?: string | null;
  vehiclePlate: string;
  trailerPlate?: string | null;
}

// Fase 25: sustituye a loginWithVehicleQrToken como puerta de entrada a la
// App Conductor -- petición explícita de Raúl ("un QR por centro + ruta +
// transportista, con formulario del conductor" en vez de un QR por
// vehículo/conductor). No requiere ninguna cuenta de conductor: la posesión
// del QR físico (pegado donde corresponda para ese circuito/transportista)
// más los datos que la persona rellena en el momento son la credencial.
// Sesión corta (16h, cubre un turno largo) en vez de heredar
// env.jwtExpiresIn -- no tiene sentido que dure semanas como una sesión de
// Backoffice.
export async function loginWithRouteQrToken(token: string, form: RouteQrFormInput) {
  const record = await resolveRouteQrToken(token);

  const routeQr: JwtPayload["routeQr"] = {
    warehouseId: record.warehouseId,
    deliveryZoneId: record.deliveryZoneId,
    carrierId: record.carrierId,
    driverName: form.driverName,
    driverDni: form.driverDni,
    driverPhone: form.driverPhone ?? null,
    vehiclePlate: form.vehiclePlate,
    trailerPlate: form.trailerPlate ?? null,
  };

  const payload: JwtPayload = {
    // No hay AppUser real detrás de esta sesión -- identificador sintético
    // del propio token de ruta, único por diseño (RouteQrToken.token es
    // @unique). Nada debe usar este valor para buscar en app_user.
    sub: `route-qr:${record.id}`,
    companyId: record.companyId,
    email: "",
    userType: "driver_app",
    roles: [],
    driverId: null,
    warehouseId: record.warehouseId,
    routeQr,
  };

  const jwtToken = jwt.sign(payload, env.jwtSecret, { expiresIn: "16h" });

  return {
    token: jwtToken,
    routeQr,
    warehouse: { id: record.warehouse.id, name: record.warehouse.name },
    deliveryZone: { id: record.deliveryZone.id, name: record.deliveryZone.name },
    carrier: { id: record.carrier.id, legalName: record.carrier.legalName },
  };
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}
