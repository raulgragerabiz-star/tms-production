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
});

carriersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const items = await prisma.carrier.findMany({
      where: { companyId: req.auth!.companyId, deletedAt: null },
      orderBy: { legalName: "asc" },
      include: { _count: { select: { vehicles: true } } },
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
