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
    const vehicle = await prisma.vehicle.create({ data });
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
    const updated = await prisma.vehicle.update({ where: { id: vehicle.id }, data });
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
      include: { carrier: { select: { legalName: true } } },
      orderBy: { fullName: "asc" },
    });
    res.json({ items, total: items.length });
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
