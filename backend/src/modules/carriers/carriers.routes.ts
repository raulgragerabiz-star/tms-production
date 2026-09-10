import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";

export const carriersRouter = Router();

const carrierSchema = z.object({
  legalName: z.string().min(1),
  taxId: z.string().min(1),
  city: z.string().optional(),
  province: z.string().optional(),
  serviceType: z.enum(["full_truck", "pallet", "both"]).optional(),
  ownsFleet: z.boolean().optional(),
  temperatureCapability: z.enum(["ambient", "refrigerated", "frozen", "mixed"]).optional(),
  notes: z.string().optional(),
  // Fase 8k: jornada laboral máxima (horas) admitida para los conductores de
  // este transportista -- ver comentario en el modelo Carrier (schema.prisma).
  maxRouteDurationHours: z.number().positive().max(24).optional(),
});

// Fase 8: se incluye qué tipos de vehículo declara poder aportar cada
// transportista (checkboxes de la pestaña "Transportistas" de "Flota y
// Transportistas") -- aditivo, el resto de la respuesta no cambia.
const carrierListInclude = {
  _count: { select: { vehicles: true } },
  vehicleTypeOfferings: { select: { vehicleType: { select: { id: true, name: true } } } },
} as const;

carriersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const items = await prisma.carrier.findMany({
      where: { companyId: req.auth!.companyId, deletedAt: null },
      orderBy: { legalName: "asc" },
      include: carrierListInclude,
    });
    res.json({ items, total: items.length });
  })
);

carriersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const carrier = await prisma.carrier.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
      include: {
        vehicles: { include: { vehicleType: true } },
        fullTruckRates: { orderBy: { validFrom: "desc" } },
        palletRates: { orderBy: { validFrom: "desc" } },
      },
    });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");
    res.json(carrier);
  })
);

carriersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = carrierSchema.parse(req.body);
    const carrier = await prisma.carrier.create({ data: { ...data, companyId: req.auth!.companyId } });
    res.status(201).json(carrier);
  })
);

carriersRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = carrierSchema.partial().parse(req.body);
    const carrier = await prisma.carrier.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");
    const updated = await prisma.carrier.update({ where: { id: carrier.id }, data });
    res.json(updated);
  })
);

// Fase 7b: faltaba dar de baja un transportista desde la aplicación (solo
// existía alta y edición). Igual que en customers.routes.ts, nunca se borra
// físicamente -- un transportista dado de baja puede seguir referenciado por
// rutas, envíos o liquidaciones históricas -- se marca inactivo y con fecha
// de baja, y desaparece de los listados (GET / ya filtra deletedAt: null).
carriersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const carrier = await prisma.carrier.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");
    await prisma.carrier.update({ where: { id: carrier.id }, data: { deletedAt: new Date(), active: false } });
    res.status(204).send();
  })
);

// Fase 8: checkboxes de tipo de vehículo en la fila del transportista dentro
// de la nueva pestaña "Transportistas" -- "seleccionar simplemente en la
// línea el tipo de vehículo que tiene". No sustituye a Vehicle (matrículas
// reales); es la capacidad declarada del transportista.
carriersRouter.post(
  "/:id/vehicle-types/:vehicleTypeId",
  asyncHandler(async (req, res) => {
    const carrier = await prisma.carrier.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");
    const vehicleType = await prisma.vehicleType.findUnique({ where: { id: req.params.vehicleTypeId } });
    if (!vehicleType) throw HttpError.notFound("Tipo de vehículo no encontrado");

    await prisma.carrierVehicleType.upsert({
      where: { carrierId_vehicleTypeId: { carrierId: carrier.id, vehicleTypeId: vehicleType.id } },
      update: {},
      create: { carrierId: carrier.id, vehicleTypeId: vehicleType.id },
    });
    res.status(201).json({ ok: true });
  })
);

carriersRouter.delete(
  "/:id/vehicle-types/:vehicleTypeId",
  asyncHandler(async (req, res) => {
    const carrier = await prisma.carrier.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");

    await prisma.carrierVehicleType.deleteMany({
      where: { carrierId: carrier.id, vehicleTypeId: req.params.vehicleTypeId },
    });
    res.status(204).send();
  })
);
