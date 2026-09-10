// Fase 8: "circuitos" de reparto (agrupación de clientes por zona de destino)
// y sus tarifas por transportista -- petición explícita de Raúl a partir de
// la plantilla real que aportó (columna "Rutas": "MAD1", "ASTURIAS (Pinto)",
// etc., con los transportistas que colaboran en cada una y su tarifa). Ver
// el comentario largo en schema.prisma (modelo DeliveryZone) para la
// diferencia con InfluenceZone (zonas de km del auto-planificador, sin
// tocar) y con ZoneRate.zoneName (texto libre del motor de tarifas de Fase 9,
// sin relación a esta tabla).
//
// Endpoints:
//   GET    /api/delivery-zones                 -- listado de circuitos
//   POST   /api/delivery-zones                 -- alta de circuito
//   PATCH  /api/delivery-zones/:id              -- editar / dar de baja
//   GET    /api/delivery-zones/assignments      -- una fila por (circuito,
//     transportista) con su tarifa vigente -- es la tabla que pidió Raúl
//     para la pestaña "Transportistas" (sustituye a Empresa+Vehículos+Tarifas)
//   POST   /api/delivery-zones/:id/rates        -- nueva tarifa de un
//     transportista para ese circuito
//   PATCH  /api/delivery-zones/rates/:id        -- editar tarifa
//   DELETE /api/delivery-zones/rates/:id        -- eliminar tarifa (igual que
//     los suplementos: fila puntual, no hay liquidaciones históricas que
//     dependan todavía de esta tabla nueva)
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { rangesOverlap } from "@/modules/rates/lib/rate-validity";

export const deliveryZonesRouter = Router();

const zoneSchema = z.object({
  name: z.string().min(1),
  warehouseId: z.string().uuid().optional().nullable(),
});

deliveryZonesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const items = await prisma.deliveryZone.findMany({
      where: { companyId: req.auth!.companyId },
      orderBy: { name: "asc" },
      include: {
        warehouse: { select: { id: true, name: true } },
        _count: { select: { customers: true, rates: true } },
      },
    });
    res.json({ items, total: items.length });
  })
);

deliveryZonesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = zoneSchema.parse(req.body);
    const existing = await prisma.deliveryZone.findFirst({
      where: { companyId: req.auth!.companyId, name: { equals: data.name, mode: "insensitive" } },
    });
    if (existing) throw HttpError.conflict("Ya existe un circuito con ese nombre");

    const zone = await prisma.deliveryZone.create({
      data: { ...data, companyId: req.auth!.companyId },
      include: { warehouse: { select: { id: true, name: true } } },
    });
    res.status(201).json(zone);
  })
);

deliveryZonesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const zone = await prisma.deliveryZone.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!zone) throw HttpError.notFound("Circuito no encontrado");

    const data = zoneSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    const updated = await prisma.deliveryZone.update({
      where: { id: zone.id },
      data,
      include: { warehouse: { select: { id: true, name: true } } },
    });
    res.json(updated);
  })
);

// Una fila por (circuito, transportista) con su tarifa más reciente --
// exactamente la tabla que pidió Raúl para reemplazar Empresa+Vehículos+
// Tarifas: "en vez de kg y pedidos, columnas según la tipología de tarifa".
deliveryZonesRouter.get(
  "/assignments",
  asyncHandler(async (req, res) => {
    const rates = await prisma.deliveryZoneRate.findMany({
      where: { deliveryZone: { companyId: req.auth!.companyId } },
      orderBy: [{ deliveryZone: { name: "asc" } }, { carrier: { legalName: "asc" } }, { validFrom: "desc" }],
      include: {
        deliveryZone: { select: { id: true, name: true, active: true, _count: { select: { customers: true } } } },
        carrier: {
          select: {
            id: true,
            legalName: true,
            taxId: true,
            active: true,
            vehicleTypeOfferings: { select: { vehicleType: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    res.json({ items: rates, total: rates.length });
  })
);

const rateSchema = z.object({
  carrierId: z.string().uuid(),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date().optional().nullable(),
  flatFee: z.number().nonnegative().optional().nullable(),
  pricePerTon: z.number().nonnegative().optional().nullable(),
  unloadFee: z.number().nonnegative().optional().nullable(),
  partnerIncomePerTon: z.number().nonnegative().optional().nullable(),
  scheduleNote: z.string().optional().nullable(),
  currency: z.string().length(3).optional(),
});

deliveryZonesRouter.post(
  "/:id/rates",
  asyncHandler(async (req, res) => {
    const zone = await prisma.deliveryZone.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!zone) throw HttpError.notFound("Circuito no encontrado");

    const data = rateSchema.parse(req.body);
    const carrier = await prisma.carrier.findFirst({ where: { id: data.carrierId, companyId: req.auth!.companyId } });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");

    const existing = await prisma.deliveryZoneRate.findMany({
      where: { deliveryZoneId: zone.id, carrierId: data.carrierId },
    });
    const clash = existing.find((r) => rangesOverlap(data.validFrom, data.validTo ?? null, r.validFrom, r.validTo));
    if (clash) throw HttpError.conflict("La vigencia se solapa con una tarifa ya registrada para ese transportista en este circuito");

    const rate = await prisma.deliveryZoneRate.create({
      data: { ...data, deliveryZoneId: zone.id },
      include: { carrier: { select: { legalName: true } }, deliveryZone: { select: { name: true } } },
    });
    res.status(201).json(rate);
  })
);

deliveryZonesRouter.patch(
  "/rates/:id",
  asyncHandler(async (req, res) => {
    const rate = await prisma.deliveryZoneRate.findFirst({
      where: { id: req.params.id, deliveryZone: { companyId: req.auth!.companyId } },
    });
    if (!rate) throw HttpError.notFound("Tarifa no encontrada");

    const data = rateSchema.partial().omit({ carrierId: true }).parse(req.body);
    if (data.validFrom || data.validTo !== undefined) {
      const validFrom = data.validFrom ?? rate.validFrom;
      const validTo = data.validTo !== undefined ? data.validTo : rate.validTo;
      const existing = await prisma.deliveryZoneRate.findMany({
        where: { deliveryZoneId: rate.deliveryZoneId, carrierId: rate.carrierId, id: { not: rate.id } },
      });
      const clash = existing.find((r) => rangesOverlap(validFrom, validTo ?? null, r.validFrom, r.validTo));
      if (clash) throw HttpError.conflict("La vigencia se solapa con otra tarifa de ese transportista en este circuito");
    }

    const updated = await prisma.deliveryZoneRate.update({
      where: { id: rate.id },
      data,
      include: { carrier: { select: { legalName: true } }, deliveryZone: { select: { name: true } } },
    });
    res.json(updated);
  })
);

deliveryZonesRouter.delete(
  "/rates/:id",
  asyncHandler(async (req, res) => {
    const rate = await prisma.deliveryZoneRate.findFirst({
      where: { id: req.params.id, deliveryZone: { companyId: req.auth!.companyId } },
    });
    if (!rate) throw HttpError.notFound("Tarifa no encontrada");
    await prisma.deliveryZoneRate.delete({ where: { id: rate.id } });
    res.status(204).send();
  })
);
