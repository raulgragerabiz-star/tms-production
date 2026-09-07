import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { rangesOverlap } from "./lib/rate-validity";
import { resolveShipmentCost } from "./rate-resolution.service";

export const ratesRouter = Router();

const fullTruckSchema = z.object({
  carrierId: z.string().uuid(),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date().optional().nullable(),
  includedKm: z.number().nonnegative(),
  extraStopFee: z.number().nonnegative(),
  extraKmFee: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
});

const palletSchema = z.object({
  carrierId: z.string().uuid(),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date().optional().nullable(),
  fixedFeePerNote: z.number().nonnegative(),
  looseItemFee: z.number().nonnegative(),
  maxWeightPerPalletKg: z.number().positive(),
  currency: z.string().length(3).optional(),
});

const surchargeSchema = z.object({
  carrierId: z.string().uuid(),
  surchargeType: z.enum(["fuel", "adr", "holiday", "toll", "waiting_time", "zone"]),
  calculationMode: z.enum(["fixed", "percentage", "per_km", "per_hour"]),
  value: z.number(),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date().optional().nullable(),
});

const customerRateSchema = z.object({
  carrierId: z.string().uuid(),
  customerId: z.string().uuid(),
  serviceType: z.enum(["full_truck", "pallet"]),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date().optional().nullable(),
  fixedAmount: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
});

const zoneRateSchema = z.object({
  carrierId: z.string().uuid(),
  serviceType: z.enum(["full_truck", "pallet"]),
  zoneName: z.string().min(1),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date().optional().nullable(),
  fixedAmount: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
});

async function assertCarrierBelongsToCompany(carrierId: string, companyId: string) {
  const carrier = await prisma.carrier.findFirst({ where: { id: carrierId, companyId } });
  if (!carrier) throw HttpError.notFound("Transportista no encontrado");
}

// ---- Camión completo ----

ratesRouter.get(
  "/full-truck",
  asyncHandler(async (req, res) => {
    const carrierId = req.query.carrierId as string | undefined;
    const items = await prisma.fullTruckRate.findMany({
      where: { carrier: { companyId: req.auth!.companyId }, ...(carrierId ? { carrierId } : {}) },
      orderBy: { validFrom: "desc" },
      include: { carrier: { select: { legalName: true } } },
    });
    res.json({ items, total: items.length });
  })
);

ratesRouter.post(
  "/full-truck",
  asyncHandler(async (req, res) => {
    const data = fullTruckSchema.parse(req.body);
    await assertCarrierBelongsToCompany(data.carrierId, req.auth!.companyId);

    const existing = await prisma.fullTruckRate.findMany({ where: { carrierId: data.carrierId } });
    const clash = existing.find((r) => rangesOverlap(data.validFrom, data.validTo ?? null, r.validFrom, r.validTo));
    if (clash) throw HttpError.conflict("La vigencia se solapa con una tarifa de camión completo existente");

    const rate = await prisma.fullTruckRate.create({ data });
    res.status(201).json(rate);
  })
);

// ---- Paletería ----

ratesRouter.get(
  "/pallet",
  asyncHandler(async (req, res) => {
    const carrierId = req.query.carrierId as string | undefined;
    const items = await prisma.palletRate.findMany({
      where: { carrier: { companyId: req.auth!.companyId }, ...(carrierId ? { carrierId } : {}) },
      orderBy: { validFrom: "desc" },
      include: { carrier: { select: { legalName: true } } },
    });
    res.json({ items, total: items.length });
  })
);

ratesRouter.post(
  "/pallet",
  asyncHandler(async (req, res) => {
    const data = palletSchema.parse(req.body);
    await assertCarrierBelongsToCompany(data.carrierId, req.auth!.companyId);

    const existing = await prisma.palletRate.findMany({ where: { carrierId: data.carrierId } });
    const clash = existing.find((r) => rangesOverlap(data.validFrom, data.validTo ?? null, r.validFrom, r.validTo));
    if (clash) throw HttpError.conflict("La vigencia se solapa con una tarifa de paletería existente");

    const rate = await prisma.palletRate.create({ data });
    res.status(201).json(rate);
  })
);

// ---- Suplementos (Fase 9: combustible, ADR, festivos, peajes, esperas, zona) ----

ratesRouter.get(
  "/surcharges",
  asyncHandler(async (req, res) => {
    const carrierId = req.query.carrierId as string | undefined;
    const items = await prisma.rateSurcharge.findMany({
      where: { carrier: { companyId: req.auth!.companyId }, ...(carrierId ? { carrierId } : {}) },
      orderBy: { validFrom: "desc" },
      include: { carrier: { select: { legalName: true } } },
    });
    res.json({ items, total: items.length });
  })
);

ratesRouter.post(
  "/surcharges",
  asyncHandler(async (req, res) => {
    const data = surchargeSchema.parse(req.body);
    await assertCarrierBelongsToCompany(data.carrierId, req.auth!.companyId);
    const surcharge = await prisma.rateSurcharge.create({ data });
    res.status(201).json(surcharge);
  })
);

ratesRouter.delete(
  "/surcharges/:id",
  asyncHandler(async (req, res) => {
    const surcharge = await prisma.rateSurcharge.findFirst({
      where: { id: req.params.id, carrier: { companyId: req.auth!.companyId } },
    });
    if (!surcharge) throw HttpError.notFound("Suplemento no encontrado");
    await prisma.rateSurcharge.delete({ where: { id: surcharge.id } });
    res.status(204).send();
  })
);

// ---- Tarifa por cliente (by_customer, prioridad máxima) ----

ratesRouter.get(
  "/customer",
  asyncHandler(async (req, res) => {
    const items = await prisma.customerRate.findMany({
      where: { carrier: { companyId: req.auth!.companyId } },
      orderBy: { validFrom: "desc" },
      include: { carrier: { select: { legalName: true } }, customer: { select: { legalName: true, businessCode: true } } },
    });
    res.json({ items, total: items.length });
  })
);

ratesRouter.post(
  "/customer",
  asyncHandler(async (req, res) => {
    const data = customerRateSchema.parse(req.body);
    await assertCarrierBelongsToCompany(data.carrierId, req.auth!.companyId);
    const customer = await prisma.customer.findFirst({ where: { id: data.customerId, companyId: req.auth!.companyId } });
    if (!customer) throw HttpError.notFound("Cliente no encontrado");

    const existing = await prisma.customerRate.findMany({
      where: { carrierId: data.carrierId, customerId: data.customerId, serviceType: data.serviceType },
    });
    const clash = existing.find((r) => rangesOverlap(data.validFrom, data.validTo ?? null, r.validFrom, r.validTo));
    if (clash) throw HttpError.conflict("La vigencia se solapa con una tarifa por cliente existente");

    const rate = await prisma.customerRate.create({ data });
    res.status(201).json(rate);
  })
);

// ---- Tarifa por zona/provincia (by_zone / by_province, prioridad intermedia) ----

ratesRouter.get(
  "/zone",
  asyncHandler(async (req, res) => {
    const items = await prisma.zoneRate.findMany({
      where: { carrier: { companyId: req.auth!.companyId } },
      orderBy: { validFrom: "desc" },
      include: { carrier: { select: { legalName: true } } },
    });
    res.json({ items, total: items.length });
  })
);

ratesRouter.post(
  "/zone",
  asyncHandler(async (req, res) => {
    const data = zoneRateSchema.parse(req.body);
    await assertCarrierBelongsToCompany(data.carrierId, req.auth!.companyId);

    const existing = await prisma.zoneRate.findMany({
      where: { carrierId: data.carrierId, zoneName: data.zoneName, serviceType: data.serviceType },
    });
    const clash = existing.find((r) => rangesOverlap(data.validFrom, data.validTo ?? null, r.validFrom, r.validTo));
    if (clash) throw HttpError.conflict("La vigencia se solapa con una tarifa de zona existente");

    const rate = await prisma.zoneRate.create({ data });
    res.status(201).json(rate);
  })
);

// ---- Simulador de coste (Fase 9): resuelve la tarifa base por prioridad
// (by_customer > by_zone/province > general del transportista) y le aplica todos
// los suplementos vigentes y aplicables a las condiciones del envío.

ratesRouter.post(
  "/simulate",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      carrierId: z.string().uuid(),
      serviceType: z.enum(["full_truck", "pallet"]),
      date: z.coerce.date().default(() => new Date()),
      km: z.number().nonnegative().optional(),
      stops: z.number().int().nonnegative().optional(),
      notesCount: z.number().int().nonnegative().optional(),
      looseItems: z.number().int().nonnegative().optional(),
      // Dimensiones del motor avanzado (Fase 9), todas opcionales para mantener
      // compatibilidad con el simulador simple ya usado por Planificador/Facturación.
      customerId: z.string().uuid().optional(),
      province: z.string().optional(),
      requiresAdr: z.boolean().optional(),
      isHoliday: z.boolean().optional(),
      waitingHours: z.number().nonnegative().optional(),
      tollAmount: z.number().nonnegative().optional(),
    });
    const input = schema.parse(req.body);
    await assertCarrierBelongsToCompany(input.carrierId, req.auth!.companyId);

    const result = await resolveShipmentCost({
      carrierId: input.carrierId,
      serviceType: input.serviceType,
      date: input.date,
      km: input.km,
      stops: input.stops,
      notesCount: input.notesCount,
      looseItems: input.looseItems,
      customerId: input.customerId,
      province: input.province,
      conditions: {
        requiresAdr: input.requiresAdr,
        isHoliday: input.isHoliday,
        waitingHours: input.waitingHours,
        tollAmount: input.tollAmount,
      },
    });

    if (!result) {
      throw HttpError.notFound(`No hay tarifa de ${input.serviceType === "full_truck" ? "camión completo" : "paletería"} vigente para esa fecha`);
    }

    res.json({ carrierId: input.carrierId, serviceType: input.serviceType, ...result });
  })
);
