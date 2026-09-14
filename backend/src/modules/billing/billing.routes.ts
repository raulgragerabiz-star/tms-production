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
    include: {
      // Fase 8T: `vehicle: { select: { vehicleTypeId: true } }` y
      // `customer: { select: { deliveryZoneId: true } }` en cada parada --
      // hace falta para poder aplicar, también al liquidar, la misma tarifa
      // por circuito+vehículo que ya se usó al simular/asignar la ruta (Fase
      // 8T en optimization.routes.ts). Aditivo: el resto de campos ya
      // incluidos no cambian.
      vehicle: { select: { vehicleTypeId: true } },
      route: {
        include: {
          loadPlan: true,
          stops: { include: { order: { include: { deliveryPoint: true, customer: { select: { deliveryZoneId: true } } } } } },
        },
      },
    },
  });
  if (!shipment.finishedAt) throw HttpError.badRequest("El envío todavía no está finalizado");

  const customerIds = new Set(shipment.route.stops.map((s) => s.order.customerId));
  const singleCustomerId = customerIds.size === 1 ? [...customerIds][0] : undefined;
  const provinces = new Set(shipment.route.stops.map((s) => s.order.deliveryPoint.province).filter(Boolean));
  const singleProvince = provinces.size === 1 ? ([...provinces][0] as string) : undefined;
  // Fase 8T: mismo criterio de "solo se propaga si todas las paradas
  // coinciden" que singleCustomerId/singleProvince arriba.
  const deliveryZoneIds = new Set(shipment.route.stops.map((s) => s.order.customer.deliveryZoneId).filter(Boolean));
  const singleDeliveryZoneId = deliveryZoneIds.size === 1 ? ([...deliveryZoneIds][0] as string) : undefined;

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
    // Fase 8T: el vehículo real que hizo el envío (shipment.vehicleId, ya
    // asignado) determina qué tarifa por circuito+vehículo aplica -- así la
    // liquidación coincide con lo que se mostró al comparar transportistas.
    deliveryZoneId: singleDeliveryZoneId,
    vehicleTypeId: shipment.vehicle.vehicleTypeId,
    weightKg: shipment.route.loadPlan?.totalWeightKg != null ? Number(shipment.route.loadPlan.totalWeightKg) : undefined,
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

// Fase 8V: filtros (petición de Raúl -- "establecer bien las facturaciones
// asociadas con los transportistas en cuanto a gasto") -- antes la lista no
// admitía filtrar por transportista/estado/periodo, inviable en cuanto hay
// más de un puñado de liquidaciones acumuladas.
const settlementListQuerySchema = z.object({
  carrierId: z.string().uuid().optional(),
  status: z.enum(["draft", "validated", "approved", "paid", "disputed"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

billingRouter.get(
  "/settlements",
  asyncHandler(async (req, res) => {
    const query = settlementListQuerySchema.parse(req.query);
    const items = await prisma.carrierSettlement.findMany({
      where: {
        carrier: { companyId: req.auth!.companyId },
        ...(query.carrierId ? { carrierId: query.carrierId } : {}),
        ...(query.status ? { status: query.status } : {}),
        // Solapamiento con el rango pedido, no "dentro de" -- una liquidación
        // que empieza antes de `from` pero termina después sigue siendo
        // relevante para ese rango.
        ...(query.from ? { periodTo: { gte: query.from } } : {}),
        ...(query.to ? { periodFrom: { lte: query.to } } : {}),
      },
      include: {
        carrier: { select: { legalName: true } },
        lines: { select: { id: true, status: true, amount: true } },
      },
      orderBy: { periodFrom: "desc" },
    });
    res.json({ items, total: items.length });
  })
);

// Fase 8V: detalle de una liquidación con sus líneas -- cada línea con el
// envío/ruta/pedido/cliente detrás, para poder revisar el gasto sin salir de
// la pantalla (antes la lista solo mostraba el nº de líneas y el total).
billingRouter.get(
  "/settlements/:id",
  asyncHandler(async (req, res) => {
    const settlement = await prisma.carrierSettlement.findFirst({
      where: { id: req.params.id, carrier: { companyId: req.auth!.companyId } },
      include: {
        carrier: { select: { legalName: true } },
        lines: {
          orderBy: { id: "asc" },
          include: {
            shipment: {
              select: {
                id: true,
                departedAt: true,
                finishedAt: true,
                vehicle: { select: { plate: true } },
                driver: { select: { fullName: true } },
                route: {
                  select: {
                    routeDate: true,
                    stops: {
                      select: {
                        order: {
                          select: {
                            orderNumber: true,
                            customer: { select: { legalName: true } },
                            deliveryPoint: { select: { city: true, province: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!settlement) throw HttpError.notFound("Liquidación no encontrada");
    res.json(settlement);
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

// Fase 8V: disputa a nivel de línea -- adaptado de
// backend/_deferred_v1.1_delta/modules/settlement/settlement-dispute.routes.ts
// (pensado originalmente para que el transportista la iniciase desde su
// portal). Ese portal no está activo todavía, así que aquí la inicia
// directamente backoffice (p. ej. tras una llamada o email del
// transportista) -- por eso cuelga de /api/billing (requireAuth normal) y no
// de un middleware de portal.
const disputeLineSchema = z.object({ comment: z.string().min(5).max(1000) });

billingRouter.patch(
  "/settlement-lines/:lineId/dispute",
  asyncHandler(async (req, res) => {
    const { comment } = disputeLineSchema.parse(req.body);

    const line = await prisma.settlementLine.findFirst({
      where: { id: req.params.lineId, carrierSettlement: { carrier: { companyId: req.auth!.companyId } } },
      include: { carrierSettlement: true },
    });
    if (!line) throw HttpError.notFound("Línea de liquidación no encontrada");
    if (line.status === "disputed") throw HttpError.badRequest("Esta línea ya está disputada");

    const updated = await prisma.settlementLine.update({
      where: { id: line.id },
      data: { status: "disputed", disputeComment: comment, disputedAt: new Date(), disputedBy: req.auth!.email },
    });

    // Misma cabecera del ciclo ya existente (Generada→Validada→Aprobada→
    // Pagada ↘ Disputada) -- si la liquidación no estaba ya disputada, pasa
    // a estarlo en cuanto una de sus líneas lo está.
    if (line.carrierSettlement.status !== "disputed") {
      await prisma.carrierSettlement.update({ where: { id: line.carrierSettlementId }, data: { status: "disputed" } });
    }

    res.json(updated);
  })
);

// Resuelve la disputa: o se acepta el importe original, o se ajusta. Si ya
// no quedan líneas disputadas en la liquidación, la cabecera vuelve a
// "validated" (revisión hecha, pendiente de re-aprobar) en vez de quedarse
// en "disputed" indefinidamente.
const resolveDisputeSchema = z.object({
  resolution: z.enum(["accept_original", "adjust_amount"]),
  newAmount: z.number().positive().optional(),
  resolutionComment: z.string().min(5).max(1000),
});

billingRouter.patch(
  "/settlement-lines/:lineId/resolve-dispute",
  asyncHandler(async (req, res) => {
    const { resolution, newAmount, resolutionComment } = resolveDisputeSchema.parse(req.body);
    if (resolution === "adjust_amount" && !newAmount) {
      throw HttpError.badRequest("Falta el nuevo importe para ajustar la línea");
    }

    const line = await prisma.settlementLine.findFirst({
      where: { id: req.params.lineId, carrierSettlement: { carrier: { companyId: req.auth!.companyId } } },
    });
    if (!line) throw HttpError.notFound("Línea de liquidación no encontrada");
    if (line.status !== "disputed") throw HttpError.badRequest("Esta línea no está disputada");

    const updated = await prisma.settlementLine.update({
      where: { id: line.id },
      data: {
        status: "accepted",
        amount: resolution === "adjust_amount" ? newAmount : line.amount,
        breakdown: {
          ...((line.breakdown as Record<string, unknown>) ?? {}),
          disputeResolution: {
            resolution,
            resolutionComment,
            resolvedBy: req.auth!.email,
            resolvedAt: new Date().toISOString(),
          },
        },
      },
    });

    const remainingDisputed = await prisma.settlementLine.count({
      where: { carrierSettlementId: line.carrierSettlementId, status: "disputed" },
    });
    const totals = await prisma.settlementLine.aggregate({
      where: { carrierSettlementId: line.carrierSettlementId },
      _sum: { amount: true },
    });
    await prisma.carrierSettlement.update({
      where: { id: line.carrierSettlementId },
      data: {
        totalAmount: totals._sum.amount ?? 0,
        ...(remainingDisputed === 0 ? { status: "validated" } : {}),
      },
    });

    res.json(updated);
  })
);
