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
//
// Fase 8T -- "que no sea una línea fija con los tipos de vehículo
// seleccionables y las tarifas al lado, sino una ficha... para seleccionar
// qué tipo de vehículos tiene y en cada vehículo incorporar la tarifa
// correspondiente" (petición explícita de Raúl, con el objetivo de que el
// motor de enrutado aplique la tarifa según el vehículo seleccionado -- ver
// rate-resolution.service.ts). Los 4 campos de importe de DeliveryZoneRate
// (flatFee/pricePerTon/unloadFee/partnerIncomePerTon) quedan como LEGACY (una
// única tarifa para todos los tipos de vehículo); la tarifa real ahora vive
// por tipo de vehículo en DeliveryZoneRateVehicleType, gestionada aquí:
//   PUT    /api/delivery-zones/rates/:rateId/vehicle-types/:vehicleTypeId
//     -- marca ese tipo de vehículo como ofertado para esta ficha y fija/edita
//     su tarifa (upsert: uno por cada tipo de vehículo seleccionado)
//   DELETE /api/delivery-zones/rates/:rateId/vehicle-types/:vehicleTypeId
//     -- desmarca ese tipo de vehículo (quita su tarifa de esta ficha)
// La vigencia (validFrom/validTo) sigue siendo la de la ficha entera
// (DeliveryZoneRate) -- todos los tipos de vehículo de una misma ficha
// comparten periodo de vigencia; si de verdad hace falta un periodo distinto
// para un tipo de vehículo concreto, se crea otra ficha (otro DeliveryZoneRate)
// para ese transportista+circuito, igual que ya funcionaba para la tarifa
// plana antes de esta fase.
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
    const now = new Date();
    const items = await prisma.deliveryZone.findMany({
      where: { companyId: req.auth!.companyId },
      orderBy: { name: "asc" },
      include: {
        warehouse: { select: { id: true, name: true } },
        _count: { select: { customers: true, rates: true } },
        // Mejora (2026-09-14): "indicar los días de la semana en que esa
        // ruta está programada para enviar, tal y como se indica en la
        // plantilla" -- el único dato de vigencia/reparto que existe hoy es
        // el `scheduleNote` libre (p.ej. "Martes y Jueves") de cada tarifa
        // circuito+transportista (DeliveryZoneRate). Un mismo circuito puede
        // tener varios transportistas con notas distintas, así que aquí se
        // traen TODAS las notas vigentes (sin repetir) en vez de asumir una
        // sola -- se deduplican y filtran en el propio handler, no hace
        // falta un campo nuevo en el schema para esto.
        rates: {
          where: { OR: [{ validTo: null }, { validTo: { gte: now } }] },
          select: { scheduleNote: true },
        },
      },
    });
    const withSchedule = items.map((z: any) => {
      const scheduleNotes = [...new Set(z.rates.map((r: any) => r.scheduleNote).filter((n: string | null): n is string => !!n?.trim()))];
      const { rates, ...rest } = z;
      return { ...rest, scheduleNotes };
    });
    res.json({ items: withSchedule, total: withSchedule.length });
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
        // Fase 15 (correcciones): se añade el almacén del circuito -- petición
        // explícita de Raúl ("tampoco permite indicar a que almacen pertenece
        // a parte de la ruta marcada"). `DeliveryZone.warehouseId` es opcional
        // (Fase 8), así que puede venir `null` para un circuito todavía sin
        // almacén asignado -- el frontend ya sabe pintar ese caso.
        deliveryZone: {
          select: {
            id: true,
            name: true,
            active: true,
            _count: { select: { customers: true } },
            warehouse: { select: { id: true, name: true } },
          },
        },
        // Fase 15: se añaden aquí los datos base del transportista (ciudad,
        // provincia, dirección, CP, teléfono, tipo de servicio, flota propia,
        // temperatura, notas y jornada máxima) -- petición explícita de Raúl
        // ("necesito poder editar los transportistas para hacer cambios en
        // sus datos base"). El bug real era que el botón "Editar" solo
        // existía para transportistas SIN circuito asignado todavía
        // (TransportistasTab.tsx, tabla de abajo); en cuanto un transportista
        // ya tenía su circuito+tarifa -- el caso normal -- desaparecía de esa
        // lista y se quedaba sin ningún punto desde el que editar sus datos
        // base. Ahora cada fila de ESTA tabla (una por circuito↔transportista)
        // trae todos los campos que exige CarrierEditable, así que también
        // puede abrir el mismo modal de edición.
        carrier: {
          select: {
            id: true,
            legalName: true,
            taxId: true,
            city: true,
            province: true,
            address: true,
            postalCode: true,
            phone: true,
            serviceType: true,
            ownsFleet: true,
            temperatureCapability: true,
            notes: true,
            maxRouteDurationHours: true,
            active: true,
            vehicleTypeOfferings: { select: { vehicleType: { select: { id: true, name: true } } } },
          },
        },
        // Fase 8T: tarifa real por tipo de vehículo de esta ficha -- lo que
        // alimenta ahora al motor de coste real (ver rate-resolution.service.ts)
        // y lo que la pantalla de Transportistas debe mostrar/editar dentro de
        // cada ficha, en vez de los 4 campos planos de arriba.
        vehicleRates: {
          include: { vehicleType: { select: { id: true, name: true, maxWeightKg: true, maxPallets: true } } },
          orderBy: { vehicleType: { maxWeightKg: "asc" } },
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
    const clash = existing.find((r: any) => rangesOverlap(data.validFrom, data.validTo ?? null, r.validFrom, r.validTo));
    if (clash) throw HttpError.conflict("La vigencia se solapa con una tarifa ya registrada para ese transportista en este circuito");

    const rate = await prisma.deliveryZoneRate.create({
      data: { ...data, deliveryZoneId: zone.id },
      include: {
        carrier: { select: { legalName: true } },
        deliveryZone: { select: { name: true } },
        vehicleRates: { include: { vehicleType: { select: { id: true, name: true } } } },
      },
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
      const clash = existing.find((r: any) => rangesOverlap(validFrom, validTo ?? null, r.validFrom, r.validTo));
      if (clash) throw HttpError.conflict("La vigencia se solapa con otra tarifa de ese transportista en este circuito");
    }

    const updated = await prisma.deliveryZoneRate.update({
      where: { id: rate.id },
      data,
      include: {
        carrier: { select: { legalName: true } },
        deliveryZone: { select: { name: true } },
        vehicleRates: { include: { vehicleType: { select: { id: true, name: true } } } },
      },
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
    // Fase 8T: al eliminar la ficha completa, se eliminan también sus
    // tarifas por tipo de vehículo (delivery_zone_rate_vehicle_type) -- si no,
    // quedarían huérfanas violando la FK. No hay liquidaciones históricas que
    // dependan todavía de esta tabla nueva (mismo criterio que ya se documentaba
    // para DeliveryZoneRate arriba).
    await prisma.deliveryZoneRateVehicleType.deleteMany({ where: { deliveryZoneRateId: rate.id } });
    await prisma.deliveryZoneRate.delete({ where: { id: rate.id } });
    res.status(204).send();
  })
);

// Fase 8T: tarifa por tipo de vehículo dentro de una ficha (DeliveryZoneRate).
// Fase 17: + pricePerKm ("€/km", coste para BigMat -- petición explícita de
// Raúl, ver comentario en schema.prisma y rate-resolution.service.ts).
const vehicleRateSchema = z.object({
  flatFee: z.number().nonnegative().optional().nullable(),
  pricePerTon: z.number().nonnegative().optional().nullable(),
  pricePerKm: z.number().nonnegative().optional().nullable(),
  unloadFee: z.number().nonnegative().optional().nullable(),
  partnerIncomePerTon: z.number().nonnegative().optional().nullable(),
});

// Marca (o edita, si ya existía) un tipo de vehículo como ofertado en esta
// ficha, con su propia tarifa -- upsert por el índice único
// (deliveryZoneRateId, vehicleTypeId). Esto es lo que hace que "al hacer el
// enrutado, aplique la tarifa según el vehículo que se seleccione": cada
// candidato de resolveShipmentCost busca aquí por su vehicleTypeId concreto.
deliveryZonesRouter.put(
  "/rates/:rateId/vehicle-types/:vehicleTypeId",
  asyncHandler(async (req, res) => {
    const rate = await prisma.deliveryZoneRate.findFirst({
      where: { id: req.params.rateId, deliveryZone: { companyId: req.auth!.companyId } },
    });
    if (!rate) throw HttpError.notFound("Ficha de tarifa no encontrada");

    const vehicleType = await prisma.vehicleType.findUnique({ where: { id: req.params.vehicleTypeId } });
    if (!vehicleType) throw HttpError.notFound("Tipo de vehículo no encontrado");

    const data = vehicleRateSchema.parse(req.body);
    const vehicleRate = await prisma.deliveryZoneRateVehicleType.upsert({
      where: { deliveryZoneRateId_vehicleTypeId: { deliveryZoneRateId: rate.id, vehicleTypeId: vehicleType.id } },
      create: { deliveryZoneRateId: rate.id, vehicleTypeId: vehicleType.id, ...data },
      update: data,
      include: { vehicleType: { select: { id: true, name: true } } },
    });
    res.json(vehicleRate);
  })
);

// Desmarca un tipo de vehículo de la ficha (quita su tarifa) -- deja de
// ofertarse ese vehículo para este circuito+transportista.
deliveryZonesRouter.delete(
  "/rates/:rateId/vehicle-types/:vehicleTypeId",
  asyncHandler(async (req, res) => {
    const rate = await prisma.deliveryZoneRate.findFirst({
      where: { id: req.params.rateId, deliveryZone: { companyId: req.auth!.companyId } },
    });
    if (!rate) throw HttpError.notFound("Ficha de tarifa no encontrada");

    await prisma.deliveryZoneRateVehicleType.deleteMany({
      where: { deliveryZoneRateId: rate.id, vehicleTypeId: req.params.vehicleTypeId },
    });
    res.status(204).send();
  })
);
