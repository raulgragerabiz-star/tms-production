import { Router } from "express";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";

export const dashboardRouter = Router();

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
