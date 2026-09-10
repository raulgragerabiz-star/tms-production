import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { geocodeAddress } from "@/modules/routing/ors.service";

export const warehousesRouter = Router();

// Fase 6: mismo criterio que en delivery-points.routes.ts -- geocodificación
// automática solo cuando falta lat/lng y hay dirección, puramente aditiva
// (cualquier fallo deja el almacén guardarse igual que antes, sin coordenadas).
async function geocodeIfMissing<T extends { address?: string; postalCode?: string; city?: string; province?: string; country?: string; lat?: number; lng?: number }>(
  data: T
): Promise<T> {
  if (data.lat != null || data.lng != null || !data.address) return data;
  try {
    const result = await geocodeAddress({
      address: data.address,
      postalCode: data.postalCode,
      city: data.city,
      province: data.province,
      country: data.country,
    });
    if (result) return { ...data, lat: result.lat, lng: result.lng };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[geocoding] no se pudo geocodificar la dirección automáticamente:", (err as Error)?.message ?? err);
  }
  return data;
}

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
    const data = await geocodeIfMissing(warehouseSchema.parse(req.body));
    const warehouse = await prisma.warehouse.create({ data: { ...data, companyId: req.auth!.companyId } });
    res.status(201).json(warehouse);
  })
);

warehousesRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = await geocodeIfMissing(warehouseSchema.partial().parse(req.body));
    const warehouse = await prisma.warehouse.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado");
    const updated = await prisma.warehouse.update({ where: { id: warehouse.id }, data });
    res.json(updated);
  })
);

// Fase 7b: dar de baja un almacén desde la aplicación (solo existía alta y
// edición). El modelo Warehouse no tiene columna deletedAt -- a diferencia de
// Customer/Carrier -- así que la baja es marcarlo inactivo; GET / ya solo
// lista los activos, y el propio almacén, sus rutas y pedidos históricos no
// se tocan para nada.
warehousesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const warehouse = await prisma.warehouse.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado");
    await prisma.warehouse.update({ where: { id: warehouse.id }, data: { active: false } });
    res.status(204).send();
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
