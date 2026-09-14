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
    // `lineCount`: cuántas SettlementLine se crearon realmente -- el frontend
    // (BillingPage.tsx, botón "Generar liquidación") lo necesita para poder
    // avisar con claridad de un resultado vacío ("0 envíos que liquidar en
    // ese periodo") en vez de un simple 201 sin más información.
    res.status(201).json({ settlement: updated, exceptions, lineCount: shipments.length - exceptions.length });
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

// Fase 8W: petición explícita de Raúl -- "las facturas tienen que indicar
// cliente, centro de envío, ruta asociada, transportista, para que se pueda
// segmentar la facturación... para tener conceptos por transporte, centro,
// ruta y cliente". Informe agregado (no toca la lista de liquidaciones de
// arriba), sobre las mismas SettlementLine ya existentes:
//   - transportista y centro (almacén de origen de la ruta) son 1:1 por
//     línea -- una liquidación es siempre de un único transportista, y un
//     envío sale siempre de un único almacén.
//   - "ruta" aquí es el CIRCUITO de reparto (`Customer.deliveryZoneId`, el
//     mismo concepto ya usado en Clientes/Pedidos desde la Fase 8U --
//     "mad01, portu4..."), no la ruta operativa de un día concreto (esa es
//     efímera, agregarla por id no tendría sentido de un periodo a otro).
//   - "cliente" (y por tanto su circuito) puede repartirse entre varios
//     clientes si el envío tuvo paradas de más de uno -- se prorratea por el
//     peso real de cada parada (decisión de Raúl). Si no se conoce el peso
//     de TODAS las paradas de esa ruta, se reparte a partes iguales en su
//     lugar (más honesto que fingir precisión que no hay), y esa línea se
//     cuenta en `equalSplitLineCount` para que quede visible en el informe.
const expenseReportQuerySchema = z.object({
  carrierId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

billingRouter.get(
  "/expense-report",
  asyncHandler(async (req, res) => {
    const query = expenseReportQuerySchema.parse(req.query);

    const lines = await prisma.settlementLine.findMany({
      where: {
        carrierSettlement: {
          carrier: { companyId: req.auth!.companyId },
          ...(query.carrierId ? { carrierId: query.carrierId } : {}),
          ...(query.from ? { periodTo: { gte: query.from } } : {}),
          ...(query.to ? { periodFrom: { lte: query.to } } : {}),
        },
      },
      select: {
        amount: true,
        carrierSettlement: {
          select: { carrierId: true, carrier: { select: { legalName: true } } },
        },
        shipment: {
          select: {
            route: {
              select: {
                warehouseId: true,
                warehouse: { select: { name: true } },
                stops: {
                  select: {
                    order: {
                      select: {
                        customerId: true,
                        customer: {
                          select: {
                            legalName: true,
                            deliveryZoneId: true,
                            deliveryZone: { select: { name: true } },
                          },
                        },
                        lines: { select: { lineWeightKg: true } },
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

    const byCarrier = new Map<string, { legalName: string; amount: number }>();
    const byWarehouse = new Map<string, { name: string; amount: number }>();
    const byDeliveryZone = new Map<string, { name: string; amount: number }>();
    const byCustomer = new Map<string, { legalName: string; amount: number }>();
    let totalAmount = 0;
    let equalSplitLineCount = 0;
    const NO_ZONE_KEY = "__sin_circuito__";

    for (const line of lines) {
      const amount = Number(line.amount);
      totalAmount += amount;

      const carrierId = line.carrierSettlement.carrierId;
      const carrierBucket = byCarrier.get(carrierId) ?? { legalName: line.carrierSettlement.carrier.legalName, amount: 0 };
      carrierBucket.amount += amount;
      byCarrier.set(carrierId, carrierBucket);

      const warehouseId = line.shipment.route.warehouseId;
      const warehouseBucket = byWarehouse.get(warehouseId) ?? { name: line.shipment.route.warehouse.name, amount: 0 };
      warehouseBucket.amount += amount;
      byWarehouse.set(warehouseId, warehouseBucket);

      const stops = line.shipment.route.stops;
      if (stops.length === 0) continue; // no debería pasar, pero no hay cliente al que atribuir

      // Peso conocido por parada -- suma de las líneas del pedido con peso
      // real (Fase 8R: un producto sin peso cargado da lineWeightKg null).
      const stopWeights = stops.map((s) => {
        const known = s.order.lines.filter((l) => l.lineWeightKg != null);
        if (known.length === 0) return null;
        return known.reduce((sum, l) => sum + Number(l.lineWeightKg), 0);
      });
      const allWeightsKnown = stopWeights.every((w) => w != null && w > 0);
      const totalWeight = allWeightsKnown ? stopWeights.reduce((a, b) => a! + b!, 0)! : 0;
      if (!allWeightsKnown) equalSplitLineCount += 1;

      stops.forEach((stop, i) => {
        const share = allWeightsKnown ? (stopWeights[i]! / totalWeight) * amount : amount / stops.length;

        const customerId = stop.order.customerId;
        const customerBucket = byCustomer.get(customerId) ?? { legalName: stop.order.customer.legalName, amount: 0 };
        customerBucket.amount += share;
        byCustomer.set(customerId, customerBucket);

        const zoneId = stop.order.customer.deliveryZoneId ?? NO_ZONE_KEY;
        const zoneName = stop.order.customer.deliveryZone?.name ?? "Sin circuito";
        const zoneBucket = byDeliveryZone.get(zoneId) ?? { name: zoneName, amount: 0 };
        zoneBucket.amount += share;
        byDeliveryZone.set(zoneId, zoneBucket);
      });
    }

    const toSortedArray = <T extends { amount: number }>(map: Map<string, T>) =>
      Array.from(map.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.amount - a.amount);

    res.json({
      totals: { totalAmount, lineCount: lines.length, equalSplitLineCount },
      byCarrier: toSortedArray(byCarrier),
      byWarehouse: toSortedArray(byWarehouse),
      byDeliveryZone: toSortedArray(byDeliveryZone),
      byCustomer: toSortedArray(byCustomer),
    });
  })
);
