import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { resolveShipmentCost } from "../rates/rate-resolution.service";

export const billingRouter = Router();

// Genera settlement_line para un shipment finished, resolviendo la tarifa (incluyendo
// suplementos y prioridad by_customer/by_zone del motor avanzado, Fase 9) vigente en la
// fecha REAL del viaje (finishedAt), nunca la tarifa "actual" (Fase 3 §12).
async function computeShipmentAmount(shipmentId: string) {
  const shipment = await prisma.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    include: { route: { include: { stops: { include: { order: { include: { deliveryPoint: true } } } } } } },
  });
  if (!shipment.finishedAt) throw HttpError.badRequest("El envío todavía no está finalizado");

  const customerIds = new Set(shipment.route.stops.map((s) => s.order.customerId));
  const singleCustomerId = customerIds.size === 1 ? [...customerIds][0] : undefined;
  const provinces = new Set(shipment.route.stops.map((s) => s.order.deliveryPoint.province).filter(Boolean));
  const singleProvince = provinces.size === 1 ? ([...provinces][0] as string) : undefined;

  const resolved = await resolveShipmentCost({
    carrierId: shipment.carrierId,
    // route.serviceType ya es uno de los 4 segmentos reales (ServiceType) — el
    // cast anterior a "full_truck"|"pallet" era simplemente incorrecto (ese
    // tipo nunca describió lo que esta columna realmente contiene).
    serviceType: shipment.route.serviceType,
    date: shipment.finishedAt,
    stops: shipment.route.stops.length,
    notesCount: shipment.route.stops.length,
    customerId: singleCustomerId,
    province: singleProvince,
  });

  if (!resolved) return null; // excepción: queda para revisión manual (sin tarifa vigente)
  return { amount: resolved.estimatedCost, appliedRateId: resolved.breakdown.baseRateId as string, breakdown: resolved.breakdown };
}

billingRouter.post(
  "/settlements",
  asyncHandler(async (req, res) => {
    const schema = z.object({ carrierId: z.string().uuid(), periodFrom: z.coerce.date(), periodTo: z.coerce.date() });
    const data = schema.parse(req.body);

    const carrier = await prisma.carrier.findFirst({ where: { id: data.carrierId, companyId: req.auth!.companyId } });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");

    const shipments = await prisma.shipment.findMany({
      where: {
        carrierId: data.carrierId,
        status: "finished",
        finishedAt: { gte: data.periodFrom, lte: data.periodTo },
        settlementLines: { none: {} }, // evita duplicar liquidación de un mismo envío
      },
    });

    const settlement = await prisma.carrierSettlement.create({
      data: { carrierId: data.carrierId, periodFrom: data.periodFrom, periodTo: data.periodTo, status: "draft", totalAmount: 0 },
    });

    let total = 0;
    const exceptions: string[] = [];
    for (const shipment of shipments) {
      const computed = await computeShipmentAmount(shipment.id);
      if (!computed) {
        exceptions.push(shipment.id);
        continue;
      }
      await prisma.settlementLine.create({
        data: {
          carrierSettlementId: settlement.id,
          shipmentId: shipment.id,
          appliedRateId: computed.appliedRateId,
          amount: computed.amount,
          breakdown: computed.breakdown,
        },
      });
      total += computed.amount;
    }

    const updated = await prisma.carrierSettlement.update({ where: { id: settlement.id }, data: { totalAmount: total } });
    res.status(201).json({ settlement: updated, exceptions });
  })
);

billingRouter.get(
  "/settlements",
  asyncHandler(async (req, res) => {
    const items = await prisma.carrierSettlement.findMany({
      where: { carrier: { companyId: req.auth!.companyId } },
      include: { carrier: { select: { legalName: true } }, lines: true },
      orderBy: { periodFrom: "desc" },
    });
    res.json({ items, total: items.length });
  })
);

billingRouter.patch(
  "/settlements/:id/status",
  asyncHandler(async (req, res) => {
    const schema = z.object({ status: z.enum(["draft", "validated", "approved", "paid", "disputed"]) });
    const { status } = schema.parse(req.body);

    const settlement = await prisma.carrierSettlement.findFirst({
      where: { id: req.params.id, carrier: { companyId: req.auth!.companyId } },
    });
    if (!settlement) throw HttpError.notFound("Liquidación no encontrada");

    const updated = await prisma.carrierSettlement.update({ where: { id: settlement.id }, data: { status } });
    res.json(updated);
  })
);
