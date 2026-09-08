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
        stops: { select: { status: true } },
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
    }

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
