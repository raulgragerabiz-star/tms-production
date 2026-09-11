import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { issueVehicleQrToken } from "./vehicle-qr.service";

export const vehiclesRouter = Router();

const vehicleSchema = z.object({
  carrierId: z.string().uuid(),
  vehicleTypeId: z.string().uuid(),
  plate: z.string().min(1),
  trailerPlate: z.string().optional(),
  workingTemperature: z.enum(["ambient", "refrigerated", "frozen", "mixed"]).optional(),
  fuelType: z.string().optional(),
  // Fase 8Q -- completar la BD de vehículos (petición de Raúl): MMA/peso
  // útil, etiqueta ambiental, radio de acción y equipamiento especial. Todo
  // opcional para no exigir rellenar nada en los vehículos ya existentes.
  // Se usan como restricciones reales en el motor de compatibilidad (ver
  // optimization.routes.ts), no solo como datos informativos.
  mmaKg: z.number().positive().optional(),
  usefulWeightKg: z.number().positive().optional(),
  emissionsLabel: z.enum(["sin_etiqueta", "b", "c", "eco", "cero_emisiones"]).optional(),
  actionRadiusKm: z.number().positive().optional(),
  hasAdr: z.boolean().optional(),
  hasCrane: z.boolean().optional(),
  hasLiftgate: z.boolean().optional(),
});

vehiclesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    // carrierId opcional: usado por el modal de asignación de rutas para
    // listar solo los vehículos del transportista ya elegido en la
    // comparativa de costes (Objetivo 2, huecos del Planificador).
    const carrierId = req.query.carrierId as string | undefined;
    const items = await prisma.vehicle.findMany({
      where: { deletedAt: null, carrier: { companyId: req.auth!.companyId }, ...(carrierId ? { carrierId } : {}) },
      include: { vehicleType: true, carrier: { select: { legalName: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ items, total: items.length });
  })
);

vehiclesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = vehicleSchema.parse(req.body);
    const carrier = await prisma.carrier.findFirst({
      where: { id: data.carrierId, companyId: req.auth!.companyId },
    });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");
    // Fase 8Q: `data` incluye los campos nuevos de la ficha del vehículo
    // (mmaKg, usefulWeightKg, emissionsLabel, actionRadiusKm, hasAdr,
    // hasCrane, hasLiftgate) -- el `as any` es solo para este sandbox, cuyo
    // Prisma Client no puede regenerarse (sin red a la CDN de Prisma) y por
    // tanto no conoce todavía las columnas recién añadidas al schema. En el
    // entorno real, tras `npx prisma generate`, estos mismos campos quedan
    // completamente tipados sin este cast.
    const vehicle = await prisma.vehicle.create({ data: data as any });
    res.status(201).json(vehicle);
  })
);

vehiclesRouter.get(
  "/types",
  asyncHandler(async (_req, res) => {
    const items = await prisma.vehicleType.findMany({ orderBy: { maxWeightKg: "asc" } });
    res.json({ items, total: items.length });
  })
);

// Objetivo 2: capacidad por volumen y dimensiones de cada tipo de vehículo --
// antes solo se podían sembrar por script, sin forma de editarlos desde
// Backoffice. VehicleType es un catálogo global (sin companyId), igual que ya
// hace el GET de arriba.
const vehicleTypeCapacitySchema = z.object({
  maxWeightKg: z.number().positive().optional(),
  maxPallets: z.number().int().positive().optional(),
  maxVolumeM3: z.number().positive().optional(),
  lengthM: z.number().positive().optional(),
  widthM: z.number().positive().optional(),
  heightM: z.number().positive().optional(),
});

vehiclesRouter.patch(
  "/types/:id",
  asyncHandler(async (req, res) => {
    const data = vehicleTypeCapacitySchema.parse(req.body);
    const vehicleType = await prisma.vehicleType.findUnique({ where: { id: req.params.id } });
    if (!vehicleType) throw HttpError.notFound("Tipo de vehículo no encontrado");
    const updated = await prisma.vehicleType.update({ where: { id: vehicleType.id }, data });
    res.json(updated);
  })
);

vehiclesRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = vehicleSchema.partial().parse(req.body);
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: req.params.id, carrier: { companyId: req.auth!.companyId } },
    });
    if (!vehicle) throw HttpError.notFound("Vehículo no encontrado");
    // Fase 8Q: mismo cast `as any` que en el POST de arriba, por el mismo
    // motivo (Prisma Client sin regenerar en este sandbox).
    const updated = await prisma.vehicle.update({ where: { id: vehicle.id }, data: data as any });
    res.json(updated);
  })
);

// QR de identificación rápida del vehículo (pegado en la cabina): backoffice
// consulta/genera el token para imprimirlo; la App del conductor lo escanea
// y lo resuelve en driver-app.routes.ts (POST /session/bind-vehicle).
vehiclesRouter.get(
  "/:id/qr-token",
  asyncHandler(async (req, res) => {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: req.params.id, carrier: { companyId: req.auth!.companyId } },
    });
    if (!vehicle) throw HttpError.notFound("Vehículo no encontrado");
    const active = await prisma.vehicleQrToken.findFirst({ where: { vehicleId: vehicle.id, active: true } });
    res.json({ token: active?.token ?? null });
  })
);

vehiclesRouter.post(
  "/:id/qr-token",
  asyncHandler(async (req, res) => {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: req.params.id, carrier: { companyId: req.auth!.companyId } },
    });
    if (!vehicle) throw HttpError.notFound("Vehículo no encontrado");
    const token = await issueVehicleQrToken(vehicle.id);
    res.status(201).json({ token });
  })
);

// ---- Conductores (Fase 10 §"Conductores") ----

const driverSchema = z.object({
  carrierId: z.string().uuid(),
  fullName: z.string().min(1),
  taxId: z.string().min(1),
  phone: z.string().optional(),
});

vehiclesRouter.get(
  "/drivers",
  asyncHandler(async (req, res) => {
    const carrierId = req.query.carrierId as string | undefined;
    const items = await prisma.driver.findMany({
      where: { carrier: { companyId: req.auth!.companyId }, ...(carrierId ? { carrierId } : {}) },
      include: {
        carrier: { select: { legalName: true } },
        // Fase 8j: petición de Raúl -- la ficha del conductor debe mostrar el
        // vehículo al que pertenece (y su QR) directamente, sin pasar por una
        // pestaña "Vehículos" aparte. Se toma la asignación vigente (validTo
        // null); si hubiera más de una abierta a la vez (no debería, pero por
        // si acaso) se queda con la más reciente.
        vehicleAssignments: {
          where: { validTo: null },
          orderBy: { validFrom: "desc" },
          take: 1,
          include: { vehicle: { select: { id: true, plate: true } } },
        },
      },
      orderBy: { fullName: "asc" },
    });
    res.json({
      items: items.map((item: (typeof items)[number]) => {
        const { vehicleAssignments, ...driver } = item;
        return { ...driver, vehicle: vehicleAssignments[0]?.vehicle ?? null };
      }),
      total: items.length,
    });
  })
);

vehiclesRouter.post(
  "/drivers",
  asyncHandler(async (req, res) => {
    const data = driverSchema.parse(req.body);
    const carrier = await prisma.carrier.findFirst({ where: { id: data.carrierId, companyId: req.auth!.companyId } });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");

    const existing = await prisma.driver.findUnique({ where: { taxId: data.taxId } });
    if (existing) throw HttpError.conflict("Ya existe un conductor con ese NIF");

    const driver = await prisma.driver.create({ data });
    res.status(201).json(driver);
  })
);

// Asigna un conductor a un vehículo (histórico de vigencia — Fase 3 `vehicle_driver`).
vehiclesRouter.post(
  "/:id/assign-driver",
  asyncHandler(async (req, res) => {
    const schema = z.object({ driverId: z.string().uuid(), validFrom: z.coerce.date().optional() });
    const data = schema.parse(req.body);

    const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.id, carrier: { companyId: req.auth!.companyId } } });
    if (!vehicle) throw HttpError.notFound("Vehículo no encontrado");
    const driver = await prisma.driver.findFirst({ where: { id: data.driverId, carrierId: vehicle.carrierId } });
    if (!driver) throw HttpError.notFound("Conductor no encontrado para este transportista");

    // Cierra la asignación vigente anterior (si la hay) antes de abrir la nueva, para
    // mantener el histórico correcto sin solapes.
    const openAssignment = await prisma.vehicleDriver.findFirst({ where: { vehicleId: vehicle.id, validTo: null } });
    const validFrom = data.validFrom ?? new Date();
    if (openAssignment) {
      await prisma.vehicleDriver.update({ where: { id: openAssignment.id }, data: { validTo: validFrom } });
    }

    const assignment = await prisma.vehicleDriver.create({ data: { vehicleId: vehicle.id, driverId: driver.id, validFrom } });
    res.status(201).json(assignment);
  })
);

// Jornadas de conductor abiertas ahora mismo (QR de conductor + jornada) --
// visibilidad para despacho de quién está de turno y con qué vehículo, sin
// tener que preguntar por radio/teléfono.
vehiclesRouter.get(
  "/drivers/shifts/active",
  asyncHandler(async (req, res) => {
    const items = await prisma.driverShift.findMany({
      where: { endedAt: null, driver: { carrier: { companyId: req.auth!.companyId } } },
      include: { driver: { select: { id: true, fullName: true } }, vehicle: { select: { plate: true } } },
      orderBy: { startedAt: "desc" },
    });
    res.json({ items });
  })
);

// Fase 8Q: hasta ahora NO existía ningún endpoint para editar un conductor ya
// creado -- solo se podía dar de alta (POST /drivers) o cambiar su estado
// activo/inactivo (PATCH /drivers/:id/active, justo debajo). Petición de
// Raúl: horario laboral programado del conductor (turno habitual), pensado
// como ayuda para detectar en el frontend jornadas reales que se alargan más
// de lo habitual (posible exceso de tacógrafo) -- ver comentario en
// Driver.usualShiftStartTime/EndTime en schema.prisma. De paso, ya que no
// existía edición general, se permite corregir aquí también nombre/NIF/
// teléfono sin tener que borrar y volver a dar de alta al conductor.
const driverUpdateSchema = z.object({
  fullName: z.string().min(1).optional(),
  taxId: z.string().min(1).optional(),
  phone: z.string().optional(),
  usualShiftStartTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido (HH:mm)")
    .optional()
    .nullable(),
  usualShiftEndTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido (HH:mm)")
    .optional()
    .nullable(),
});

vehiclesRouter.patch(
  "/drivers/:id",
  asyncHandler(async (req, res) => {
    const data = driverUpdateSchema.parse(req.body);
    const driver = await prisma.driver.findFirst({ where: { id: req.params.id, carrier: { companyId: req.auth!.companyId } } });
    if (!driver) throw HttpError.notFound("Conductor no encontrado");

    if (data.taxId && data.taxId !== driver.taxId) {
      const existing = await prisma.driver.findUnique({ where: { taxId: data.taxId } });
      if (existing) throw HttpError.conflict("Ya existe otro conductor con ese NIF");
    }

    // `as any`: mismo motivo que en el resto de campos nuevos de esta fase
    // (usualShiftStartTime/EndTime todavía no están en el Prisma Client de
    // este sandbox, que no puede regenerarse aquí).
    const updated = await prisma.driver.update({ where: { id: driver.id }, data: data as any });
    res.json(updated);
  })
);

// Fase 8j: hasta ahora un conductor no se podía ni desactivar ni eliminar
// desde Backoffice una vez creado. Se añade el mismo patrón ya usado en
// Usuarios: "Desactivar/Reactivar" (active=false/true, sin tocar nada más) y
// "Eliminar" de verdad, pero aquí SÍ hay relaciones reales con historial
// (DriverShift, Shipment) a diferencia de AppUser -- por eso el borrado
// físico solo se permite si el conductor todavía no tiene ninguna jornada ni
// envío registrado; si los tiene, se pide desactivarlo en su lugar para no
// destruir histórico real.
vehiclesRouter.patch(
  "/drivers/:id/active",
  asyncHandler(async (req, res) => {
    const schema = z.object({ active: z.boolean() });
    const { active } = schema.parse(req.body);

    const driver = await prisma.driver.findFirst({ where: { id: req.params.id, carrier: { companyId: req.auth!.companyId } } });
    if (!driver) throw HttpError.notFound("Conductor no encontrado");

    const updated = await prisma.driver.update({ where: { id: driver.id }, data: { active } });
    res.json({ id: updated.id, active: updated.active });
  })
);

vehiclesRouter.delete(
  "/drivers/:id",
  asyncHandler(async (req, res) => {
    const driver = await prisma.driver.findFirst({ where: { id: req.params.id, carrier: { companyId: req.auth!.companyId } } });
    if (!driver) throw HttpError.notFound("Conductor no encontrado");

    const [shipmentCount, shiftCount] = await Promise.all([
      prisma.shipment.count({ where: { driverId: driver.id } }),
      prisma.driverShift.count({ where: { driverId: driver.id } }),
    ]);
    if (shipmentCount > 0 || shiftCount > 0) {
      throw HttpError.badRequest(
        `Este conductor ya tiene ${shipmentCount} envío(s) y ${shiftCount} jornada(s) registrados -- no se puede eliminar sin perder ese histórico. Desactívalo en su lugar.`
      );
    }

    // vehicleDriver sí se puede borrar sin problema: es solo el histórico de
    // a qué vehículo ha estado asignado, no un registro operativo en sí.
    await prisma.vehicleDriver.deleteMany({ where: { driverId: driver.id } });
    await prisma.driver.delete({ where: { id: driver.id } });
    res.status(204).send();
  })
);
