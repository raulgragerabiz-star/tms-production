import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";

export const dashboardRouter = Router();

// "Histórico y analítica" (último paso del flujo de las instrucciones
// ampliadas: pedido -> ... -> confirmación digital -> histórico y
// analítica). Existe un módulo de KPIs mucho más ambicioso ya escrito en
// `_deferred_v1.1_delta/modules/kpi/` (150+ combinaciones dimensión×métrica),
// pero depende de una vista materializada de Postgres pensada para un schema
// anterior -- adaptarla a ciegas (sin acceso a la base de datos real desde
// aquí para probarla) es un riesgo innecesario. Esta v1 cubre lo mismo que
// pide el flujo (coste real vs. estimado, OTIF, incidencias, ocupación,
// distancia, por periodo y por transportista) con Prisma normal -- sin SQL a
// medida ni migraciones, así que es tan seguro de desplegar como el resto de
// endpoints de esta sesión.

type Granularity = "day" | "week" | "month";

function bucketKey(date: Date, granularity: Granularity): string {
  if (granularity === "day") return date.toISOString().slice(0, 10);
  if (granularity === "month") return `${date.toISOString().slice(0, 7)}-01`;
  // Semana ISO (lunes como inicio), en UTC para no depender de la zona
  // horaria del proceso.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dayOfWeek);
  return d.toISOString().slice(0, 10);
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

dashboardRouter.get(
  "/history",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      from: z.coerce.date(),
      to: z.coerce.date(),
      warehouseId: z.string().uuid().optional(),
      carrierId: z.string().uuid().optional(),
      groupBy: z.enum(["day", "week", "month"]).optional(),
    });
    const query = schema.parse(req.query);
    if (query.from > query.to) throw HttpError.badRequest("La fecha de inicio no puede ser posterior a la de fin");

    const spanDays = (query.to.getTime() - query.from.getTime()) / (1000 * 60 * 60 * 24);
    const granularity: Granularity = query.groupBy ?? (spanDays <= 31 ? "day" : spanDays <= 180 ? "week" : "month");

    const routes = await prisma.route.findMany({
      where: {
        companyId: req.auth!.companyId,
        routeDate: { gte: query.from, lte: query.to },
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.carrierId ? { carrierId: query.carrierId } : {}),
      },
      include: {
        loadPlan: { select: { weightOccupancyPct: true, palletOccupancyPct: true, distanceKm: true } },
        // Ampliado para los dos gráficos nuevos de Analítica ("Top zonas por
        // volumen" y "Segmentación ABC de clientes"): hace falta el peso y el
        // destino/cliente de cada parada, no solo su estado. Aditivo -- el
        // resto de bloques que ya usaban `stops` (OTIF, nº de paradas) siguen
        // leyendo `status` exactamente igual.
        stops: {
          select: {
            status: true,
            order: {
              select: {
                customerId: true,
                customer: { select: { legalName: true } },
                deliveryPoint: { select: { province: true, city: true } },
                lines: { select: { lineWeightKg: true } },
              },
            },
          },
        },
        costSimulations: { where: { isSelected: true }, select: { estimatedCost: true } },
        carrier: { select: { id: true, legalName: true } },
        shipment: {
          select: {
            id: true,
            settlementLines: { select: { amount: true } },
            incidents: { select: { id: true } },
          },
        },
      },
      orderBy: { routeDate: "asc" },
    });

    interface Bucket {
      period: string;
      routes: number;
      stopsTotal: number;
      stopsCompleted: number;
      incidents: number;
      costReal: number;
      costEstimated: number;
      weightOccupancySum: number;
      palletOccupancySum: number;
      distanceKm: number;
    }
    const emptyBucket = (period: string): Bucket => ({
      period,
      routes: 0,
      stopsTotal: 0,
      stopsCompleted: 0,
      incidents: 0,
      costReal: 0,
      costEstimated: 0,
      weightOccupancySum: 0,
      palletOccupancySum: 0,
      distanceKm: 0,
    });

    const buckets = new Map<string, Bucket>();
    const byCarrier = new Map<string, { carrierId: string; legalName: string; routes: number; incidents: number; costReal: number }>();
    // "Top zonas por volumen": peso movido por provincia (o población si no
    // hay provincia) del punto de entrega de cada parada -- aproximación real
    // a la idea de "ranking de rutas/zonas" del panel BI de referencia que
    // aportó Raúl, con datos que sí existen en el schema (no hay un código de
    // ruta/zona propio como "NOR1"/"MAD 02" en este TMS).
    const zoneWeight = new Map<string, number>();
    // Segmentación ABC de clientes por peso acumulado (Pareto): mismo criterio
    // que ya usa Product.abcClass para rotación de producto, aplicado aquí a
    // clientes por el peso movido en el periodo seleccionado.
    const customerWeight = new Map<string, { legalName: string; weightKg: number }>();

    for (const r of routes) {
      const key = bucketKey(r.routeDate, granularity);
      const b = buckets.get(key) ?? emptyBucket(key);
      const costReal = r.shipment?.settlementLines.reduce((acc, l) => acc + Number(l.amount), 0) ?? 0;
      const costEstimated = r.costSimulations.reduce((acc, c) => acc + Number(c.estimatedCost), 0);
      const incidents = r.shipment?.incidents.length ?? 0;

      b.routes += 1;
      b.stopsTotal += r.stops.length;
      b.stopsCompleted += r.stops.filter((s) => s.status === "completed").length;
      b.incidents += incidents;
      b.costReal += costReal;
      b.costEstimated += costEstimated;
      b.weightOccupancySum += r.loadPlan ? Number(r.loadPlan.weightOccupancyPct) : 0;
      b.palletOccupancySum += r.loadPlan ? Number(r.loadPlan.palletOccupancyPct) : 0;
      b.distanceKm += r.loadPlan?.distanceKm ? Number(r.loadPlan.distanceKm) : 0;
      buckets.set(key, b);

      if (r.carrier) {
        const c = byCarrier.get(r.carrier.id) ?? { carrierId: r.carrier.id, legalName: r.carrier.legalName, routes: 0, incidents: 0, costReal: 0 };
        c.routes += 1;
        c.incidents += incidents;
        c.costReal += costReal;
        byCarrier.set(r.carrier.id, c);
      }

      for (const stop of r.stops) {
        const order = stop.order;
        const stopWeight = order.lines.reduce((acc, l) => acc + Number(l.lineWeightKg ?? 0), 0);
        const zone = order.deliveryPoint.province || order.deliveryPoint.city || "Sin zona";
        zoneWeight.set(zone, (zoneWeight.get(zone) ?? 0) + stopWeight);

        const cw = customerWeight.get(order.customerId) ?? { legalName: order.customer.legalName, weightKg: 0 };
        cw.weightKg += stopWeight;
        customerWeight.set(order.customerId, cw);
      }
    }

    const topZones = [...zoneWeight.entries()]
      .map(([zone, weightKg]) => ({ zone, weightKg: Math.round(weightKg) }))
      .sort((a, b) => b.weightKg - a.weightKg)
      .slice(0, 10);

    // Clasificación ABC: A = clientes cuyo peso acumulado (de mayor a menor)
    // llega hasta el 70% del total movido en el periodo; B hasta el 90%; C
    // hasta el 98%; D el resto -- mismos cortes que muestra el panel de
    // referencia de Raúl. El tamaño de cada "tarta" de la dona es el número de
    // clientes en cada clase (revela la concentración real: pocos clientes
    // grandes cargan la mayoría del peso), no el peso -- que por construcción
    // rondaría siempre 70/20/8/2.
    const sortedCustomers = [...customerWeight.values()].sort((a, b) => b.weightKg - a.weightKg);
    const totalCustomerWeight = sortedCustomers.reduce((acc, c) => acc + c.weightKg, 0);
    const abcClasses: Array<{ cls: "A" | "B" | "C" | "D"; customerCount: number; weightKg: number }> = [
      { cls: "A", customerCount: 0, weightKg: 0 },
      { cls: "B", customerCount: 0, weightKg: 0 },
      { cls: "C", customerCount: 0, weightKg: 0 },
      { cls: "D", customerCount: 0, weightKg: 0 },
    ];
    let cumulativeWeight = 0;
    for (const c of sortedCustomers) {
      cumulativeWeight += c.weightKg;
      const cumulativePct = totalCustomerWeight > 0 ? (cumulativeWeight / totalCustomerWeight) * 100 : 100;
      const bucket =
        cumulativePct <= 70 ? abcClasses[0] : cumulativePct <= 90 ? abcClasses[1] : cumulativePct <= 98 ? abcClasses[2] : abcClasses[3];
      bucket.customerCount += 1;
      bucket.weightKg += c.weightKg;
    }
    const customerAbc = abcClasses.map((c) => ({ ...c, weightKg: Math.round(c.weightKg) }));

    const sortedBuckets = [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period));

    const totals = sortedBuckets.reduce(
      (acc, b) => ({
        routes: acc.routes + b.routes,
        stopsTotal: acc.stopsTotal + b.stopsTotal,
        stopsCompleted: acc.stopsCompleted + b.stopsCompleted,
        incidents: acc.incidents + b.incidents,
        costReal: acc.costReal + b.costReal,
        costEstimated: acc.costEstimated + b.costEstimated,
        distanceKm: acc.distanceKm + b.distanceKm,
      }),
      { routes: 0, stopsTotal: 0, stopsCompleted: 0, incidents: 0, costReal: 0, costEstimated: 0, distanceKm: 0 }
    );

    res.json({
      range: { from: query.from, to: query.to, groupBy: granularity },
      totals: {
        routes: totals.routes,
        otifPct: pct(totals.stopsCompleted, totals.stopsTotal),
        incidents: totals.incidents,
        incidentRatePct: pct(totals.incidents, totals.routes),
        costReal: totals.costReal,
        costEstimated: totals.costEstimated,
        costDeviationPct: totals.costEstimated > 0 ? Math.round(((totals.costReal - totals.costEstimated) / totals.costEstimated) * 1000) / 10 : null,
        distanceKm: Math.round(totals.distanceKm),
      },
      buckets: sortedBuckets.map((b) => ({
        period: b.period,
        routes: b.routes,
        otifPct: pct(b.stopsCompleted, b.stopsTotal),
        incidents: b.incidents,
        costReal: Math.round(b.costReal * 100) / 100,
        costEstimated: Math.round(b.costEstimated * 100) / 100,
        weightOccupancyPct: b.routes > 0 ? Math.round((b.weightOccupancySum / b.routes) * 1000) / 10 : 0,
        palletOccupancyPct: b.routes > 0 ? Math.round((b.palletOccupancySum / b.routes) * 1000) / 10 : 0,
        distanceKm: Math.round(b.distanceKm),
      })),
      byCarrier: [...byCarrier.values()]
        .sort((a, b) => b.routes - a.routes)
        .map((c) => ({ ...c, costReal: Math.round(c.costReal * 100) / 100 })),
      topZones,
      customerAbc,
    });
  })
);

dashboardRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const [
      pendingOrders,
      inTransitShipments,
      deliveredToday,
      totalToday,
      openIncidents,
      routesInPreparation,
    ] = await Promise.all([
      prisma.order.count({ where: { companyId, status: { in: ["received", "validated"] } } }),
      prisma.shipment.count({ where: { route: { companyId }, status: "in_transit" } }),
      prisma.routeStop.count({ where: { route: { companyId }, status: "completed" } }),
      prisma.routeStop.count({ where: { route: { companyId } } }),
      prisma.incident.count({ where: { shipment: { route: { companyId } }, status: "open" } }),
      prisma.route.count({ where: { companyId, status: { in: ["draft", "optimized"] } } }),
    ]);

    const todaysSettlementLines = await prisma.settlementLine.findMany({
      where: {
        shipment: { route: { companyId }, finishedAt: { gte: startOfDay, lte: endOfDay } },
      },
    });
    const costToday = todaysSettlementLines.reduce((acc, l) => acc + Number(l.amount), 0);

    const otifPct = totalToday > 0 ? Math.round((deliveredToday / totalToday) * 100) : 100;

    res.json({
      pendingOrders,
      routesInPreparation,
      inTransitShipments,
      deliveredToday,
      totalStopsToday: totalToday,
      otifPct,
      openIncidents,
      costToday,
    });
  })
);

dashboardRouter.get(
  "/incidents",
  asyncHandler(async (req, res) => {
    const items = await prisma.incident.findMany({
      where: { shipment: { route: { companyId: req.auth!.companyId } }, status: "open" },
      include: { shipment: { include: { carrier: { select: { legalName: true } } } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    res.json({ items, total: items.length });
  })
);

dashboardRouter.get(
  "/carrier-ranking",
  asyncHandler(async (req, res) => {
    const carriers = await prisma.carrier.findMany({
      where: { companyId: req.auth!.companyId, active: true },
      include: {
        shipments: { include: { route: { include: { stops: true } } } },
        _count: { select: { shipments: true } },
      },
    });

    const ranking = await Promise.all(
      carriers.map(async (c) => {
        const incidents = await prisma.incident.count({ where: { shipment: { carrierId: c.id } } });
        const finished = c.shipments.filter((s) => s.status === "finished");
        return {
          carrierId: c.id,
          legalName: c.legalName,
          totalShipments: c._count.shipments,
          finishedShipments: finished.length,
          incidents,
        };
      })
    );

    ranking.sort((a, b) => a.incidents - b.incidents);
    res.json({ items: ranking });
  })
);
