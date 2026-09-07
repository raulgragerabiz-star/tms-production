import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";

export const warehousesRouter = Router();

const warehouseSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  country: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  isCrossDock: z.boolean().optional(),
  // Punto de enlace con sistemas externos (ver README, "Integración con proyecto de
  // Layout de Almacén"): externalCode correlaciona este almacén con su equivalente en
  // otro sistema; layoutJson admite cualquier estructura (muelles, zonas, pasillos) que
  // el proyecto de layout necesite leer/escribir, sin acoplar el TMS a un formato fijo.
  externalCode: z.string().optional(),
  layoutJson: z.any().optional(),
});

warehousesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const items = await prisma.warehouse.findMany({
      where: { companyId: req.auth!.companyId, active: true },
      orderBy: { name: "asc" },
    });
    res.json({ items, total: items.length });
  })
);

// Búsqueda por externalCode: permite a un sistema externo (p. ej. el proyecto de layout
// de almacén) resolver "su" almacén contra el TMS sin conocer el UUID interno.
warehousesRouter.get(
  "/by-external-code/:externalCode",
  asyncHandler(async (req, res) => {
    const warehouse = await prisma.warehouse.findFirst({
      where: { externalCode: req.params.externalCode, companyId: req.auth!.companyId },
    });
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado para ese externalCode");
    res.json(warehouse);
  })
);

warehousesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = warehouseSchema.parse(req.body);
    const warehouse = await prisma.warehouse.create({ data: { ...data, companyId: req.auth!.companyId } });
    res.status(201).json(warehouse);
  })
);

warehousesRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = warehouseSchema.partial().parse(req.body);
    const warehouse = await prisma.warehouse.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado");
    const updated = await prisma.warehouse.update({ where: { id: warehouse.id }, data });
    res.json(updated);
  })
);

// Actualización parcial específica del layout, para que el proyecto externo pueda
// escribir solo su porción de datos sin tener que reenviar el resto de campos del almacén.
warehousesRouter.patch(
  "/:id/layout",
  asyncHandler(async (req, res) => {
    const schema = z.object({ layoutJson: z.any() });
    const { layoutJson } = schema.parse(req.body);
    const warehouse = await prisma.warehouse.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado");
    const updated = await prisma.warehouse.update({ where: { id: warehouse.id }, data: { layoutJson } });
    res.json(updated);
  })
);
