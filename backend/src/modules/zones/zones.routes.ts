// Objetivo 2 (Planificación y enrutado automático): "zona de influencia" --
// franjas de km desde un almacén, cada una con el tipo de vehículo que se le
// asigna. Por ahora es una tabla de configuración de solo consulta/edición
// manual desde Backoffice; el heurístico de auto-asignación (pendiente de
// diseño de negocio, ver backlog) podrá apoyarse en ella más adelante.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";

export const zonesRouter = Router();

const zoneInclude = { vehicleType: { select: { id: true, name: true } } } as const;

// GET /api/zones/warehouses/:warehouseId — franjas de un almacén, ordenadas por km.
zonesRouter.get(
  "/warehouses/:warehouseId",
  asyncHandler(async (req, res) => {
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: req.params.warehouseId, companyId: req.auth!.companyId },
    });
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado");

    const items = await prisma.influenceZone.findMany({
      where: { warehouseId: warehouse.id },
      include: zoneInclude,
      orderBy: { kmMin: "asc" },
    });
    res.json({ items });
  })
);

const zoneSchema = z.object({
  kmMin: z.number().min(0),
  kmMax: z.number().min(0),
  vehicleTypeId: z.string().uuid(),
  weeklyShipments: z.number().min(0).optional(),
});

// POST /api/zones/warehouses/:warehouseId — nueva franja para ese almacén.
zonesRouter.post(
  "/warehouses/:warehouseId",
  asyncHandler(async (req, res) => {
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: req.params.warehouseId, companyId: req.auth!.companyId },
    });
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado");

    const data = zoneSchema.parse(req.body);
    if (data.kmMax <= data.kmMin) {
      throw HttpError.badRequest("El km máximo debe ser mayor que el km mínimo");
    }

    const zone = await prisma.influenceZone.create({
      data: { warehouseId: warehouse.id, ...data },
      include: zoneInclude,
    });
    res.status(201).json(zone);
  })
);

// PATCH /api/zones/:id — edición inline de cualquier campo de la franja.
zonesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const zone = await prisma.influenceZone.findFirst({
      where: { id: req.params.id, warehouse: { companyId: req.auth!.companyId } },
    });
    if (!zone) throw HttpError.notFound("Zona no encontrada");

    const data = zoneSchema.partial().parse(req.body);
    const kmMin = data.kmMin ?? Number(zone.kmMin);
    const kmMax = data.kmMax ?? Number(zone.kmMax);
    if (kmMax <= kmMin) {
      throw HttpError.badRequest("El km máximo debe ser mayor que el km mínimo");
    }

    const updated = await prisma.influenceZone.update({
      where: { id: zone.id },
      data,
      include: zoneInclude,
    });
    res.json(updated);
  })
);

// DELETE /api/zones/:id
zonesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const zone = await prisma.influenceZone.findFirst({
      where: { id: req.params.id, warehouse: { companyId: req.auth!.companyId } },
    });
    if (!zone) throw HttpError.notFound("Zona no encontrada");
    await prisma.influenceZone.delete({ where: { id: zone.id } });
    res.status(204).send();
  })
);