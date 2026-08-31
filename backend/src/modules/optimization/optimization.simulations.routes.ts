import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import { prisma } from "../../lib/prisma";

// Router adicional sobre el módulo de optimización ya existente:
// app.use("/api/optimization", optimizationSimulationsRoutes)
// Cierra el hueco que dejaba las rutas en `optimized` sin UI accionable
// (issue abierto de la sesión anterior).

const router = Router();

// GET /api/optimization/:routeId/simulations
router.get("/:routeId/simulations", requireAuth, async (req, res, next) => {
  try {
    const { routeId } = req.params;

    const [simulations, loadPlan] = await Promise.all([
      prisma.costSimulation.findMany({
        where: { routeId },
        include: {
          carrier: { select: { legalName: true } },
          vehicleType: { select: { name: true, maxWeightKg: true, maxPallets: true } },
        },
        orderBy: { estimatedCost: "asc" },
      }),
      prisma.loadPlan.findUnique({ where: { routeId } }),
    ]);

    const response = simulations.map((s) => ({
      id: s.id,
      carrierId: s.carrierId,
      carrierName: s.carrier.legalName,
      vehicleTypeId: s.vehicleTypeId,
      vehicleTypeName: s.vehicleType.name,
      estimatedCost: Number(s.estimatedCost),
      currency: (s.costBreakdown as any)?.currency ?? "EUR",
      costBreakdown: s.costBreakdown,
      occupancy: {
        weightPct: loadPlan && s.vehicleType.maxWeightKg
          ? (Number(loadPlan.totalWeightKg) / Number(s.vehicleType.maxWeightKg)) * 100
          : 0,
        palletsPct: loadPlan && s.vehicleType.maxPallets
          ? (Number(loadPlan.totalPallets) / Number(s.vehicleType.maxPallets)) * 100
          : 0,
      },
      isSelected: s.isSelected,
    }));

    return res.status(200).json(response);
  } catch (err) {
    next(err);
  }
});

// GET /api/routes/:routeId  (versión resumida para la cabecera del modal)
router.get("/summary/:routeId", requireAuth, async (req, res, next) => {
  try {
    const { routeId } = req.params;
    const route = await prisma.route.findUniqueOrThrow({
      where: { id: routeId },
      include: { routeStops: { include: { order: true } } },
    });

    // El segmento predominante de la ruta = el del primer pedido (todas las
    // paradas de una misma ruta comparten segmento por construcción, ya que
    // la agrupación por zona ya filtra por compatibleSegments antes de
    // consolidar, documento v1.1 §3).
    const segment = route.routeStops[0]?.order?.serviceType ?? "gran_volumen";

    // Optimización automática (pasada 8): comprueba si la última mutación
    // de audit_log sobre esta ruta fue una auto-asignación, para que el
    // planificador vea el porqué de la asignación sin tener que ir a
    // buscarlo — sigue pudiendo reasignar manualmente desde este mismo modal.
    const lastAutoAssignLog = await prisma.auditLog.findFirst({
      where: { entityName: "route", entityId: routeId, action: "update" },
      orderBy: { createdAt: "desc" },
    });
    const autoAssignInfo =
      lastAutoAssignLog && (lastAutoAssignLog.newValue as any)?.autoAssigned === true
        ? {
            autoAssigned: true,
            confidence: (lastAutoAssignLog.newValue as any).confidence ?? null,
          }
        : { autoAssigned: false, confidence: null };

    return res.status(200).json({
      id: route.id,
      segment,
      serviceType: route.serviceType,
      routeDate: route.routeDate,
      stopsCount: route.routeStops.length,
      ...autoAssignInfo,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
