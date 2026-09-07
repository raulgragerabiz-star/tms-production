import { prisma } from "../../lib/prisma";
import {
  scoreCandidates,
  selectBestCandidateAutomatically,
  CandidateForScoring,
  OrderContextForScoring,
} from "./auto-optimization.service";

export interface AutoAssignOutcome {
  autoAssigned: boolean;
  routeId: string;
  confidence: number | null;
  reason: string;
  costSimulationId?: string;
}

/**
 * Se invoca justo después de que el motor de optimización (Fase 8) genere
 * los `cost_simulation` de una ruta recién pasada a `optimized` — punto de
 * enganche natural en tu controller de optimización ya existente, después
 * de `route.status = 'optimized'`. Documento: "el sistema no solo sugiere
 * sino que asigna automáticamente... cuando la confianza del modelo supera
 * un umbral configurable" — por eso `company.autoAssignEnabled` se
 * comprueba primero y en falso no hace nada (opt-in real, nunca activo por
 * defecto).
 */
export async function autoAssignRouteIfEligible(routeId: string): Promise<AutoAssignOutcome> {
  const route = await prisma.route.findUniqueOrThrow({
    where: { id: routeId },
    include: {
      company: { select: { autoAssignEnabled: true, autoAssignMinConfidence: true } },
      routeStops: { include: { order: true } },
    },
  });

  if (!route.company.autoAssignEnabled) {
    return { autoAssigned: false, routeId, confidence: null, reason: "auto_assign_disabled_for_company" };
  }

  // Fase 8 ya deja registrado: "el motor nunca reasigna automáticamente
  // una ruta ya `confirmed` por el transportista sin aviso explícito" —
  // se respeta el mismo límite aquí, doble check defensivo.
  if (route.status !== "optimized") {
    return { autoAssigned: false, routeId, confidence: null, reason: `route_not_in_optimized_status (${route.status})` };
  }

  const orderContext = buildOrderContext(route.routeStops.map((s) => s.order));

  const candidates = await loadCandidatesForScoring(routeId, route.companyId);
  if (candidates.length === 0) {
    return { autoAssigned: false, routeId, confidence: null, reason: "no_cost_simulations_available" };
  }

  const result = selectBestCandidateAutomatically(
    candidates,
    orderContext,
    Number(route.company.autoAssignMinConfidence)
  );

  if (!result.selected) {
    return { autoAssigned: false, routeId, confidence: result.confidence, reason: result.reason };
  }

  await applySelection(routeId, result.selected.costSimulationId, result.selected.carrierId, result);

  return {
    autoAssigned: true,
    routeId,
    confidence: result.confidence,
    reason: result.reason,
    costSimulationId: result.selected.costSimulationId,
  };
}

function buildOrderContext(orders: { serviceType: string; requestedDeliveryDate: Date; createdAt: Date; requiresAdr?: boolean | null }[]): OrderContextForScoring {
  // El segmento de la ruta = el de sus pedidos (todos comparten segmento
  // por construcción, ver zone-grouping.service.ts). leadTimeDays = el
  // más urgente de todos los pedidos de la ruta manda — una ruta con un
  // pedido urgente entre varios no urgentes se trata como urgente.
  const segment = (orders[0]?.serviceType as any) ?? "gran_volumen";
  const leadTimeDays = Math.min(
    ...orders.map((o) => diasHabilesSimple(o.createdAt, o.requestedDeliveryDate))
  );
  const requiresAdr = orders.some((o) => o.requiresAdr === true);

  return { segment, leadTimeDays: Number.isFinite(leadTimeDays) ? leadTimeDays : 99, requiresAdr };
}

function diasHabilesSimple(from: Date, to: Date): number {
  if (to <= from) return 0;
  let count = 0;
  const cursor = new Date(from);
  const end = new Date(to);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

async function loadCandidatesForScoring(routeId: string, companyId: string): Promise<CandidateForScoring[]> {
  const [simulations, loadPlan] = await Promise.all([
    prisma.costSimulation.findMany({
      where: { routeId },
      include: { vehicleType: { select: { maxWeightKg: true, maxPallets: true } } },
    }),
    prisma.loadPlan.findUnique({ where: { routeId } }),
  ]);

  const carrierIds = Array.from(new Set(simulations.map((s) => s.carrierId)));

  // Fiabilidad de distancia por transportista — mismo cálculo que
  // detectAndPersistRouteDistanceAnomalies (anomaly-detection.service.ts),
  // reutilizado aquí como señal continua en vez de solo como alerta
  // binaria: no hace falta que haya cruzado el umbral de anomalía para
  // que la desviación influya en la puntuación.
  const distanceStats = await prisma.$queryRaw<{ carrier_id: string; avg_deviation_pct: number | null }[]>`
    SELECT
      r.carrier_id,
      avg(
        CASE WHEN r.distance_planned_km > 0
          THEN ((r.distance_real_km - r.distance_planned_km) / r.distance_planned_km) * 100
          ELSE NULL
        END
      ) AS avg_deviation_pct
    FROM route r
    WHERE r.carrier_id = ANY(${carrierIds})
      AND r.company_id = ${companyId}
      AND r.status = 'closed'
      AND r.route_date >= now() - interval '14 days'
    GROUP BY r.carrier_id
  `;
  const deviationByCarrier = new Map(distanceStats.map((s) => [s.carrier_id, s.avg_deviation_pct]));

  const anomalyCounts = await prisma.anomalyAlert.groupBy({
    by: ["entityId"],
    where: {
      companyId,
      entityId: { in: carrierIds },
      status: "pending",
      detectedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    _count: { id: true },
  });
  const anomalyCountByCarrier = new Map(anomalyCounts.map((a) => [a.entityId, a._count.id]));

  return simulations.map((s) => ({
    costSimulationId: s.id,
    carrierId: s.carrierId,
    estimatedCost: Number(s.estimatedCost),
    weightOccupancyPct:
      loadPlan && s.vehicleType.maxWeightKg
        ? Math.min(100, (Number(loadPlan.totalWeightKg) / Number(s.vehicleType.maxWeightKg)) * 100)
        : 0,
    palletOccupancyPct:
      loadPlan && s.vehicleType.maxPallets
        ? Math.min(100, (Number(loadPlan.totalPallets) / Number(s.vehicleType.maxPallets)) * 100)
        : 0,
    carrierAvgDistanceDeviationPct: deviationByCarrier.get(s.carrierId) ?? null,
    carrierRecentAnomalyCount: anomalyCountByCarrier.get(s.carrierId) ?? 0,
  }));
}

async function applySelection(
  routeId: string,
  costSimulationId: string,
  carrierId: string,
  result: Awaited<ReturnType<typeof selectBestCandidateAutomatically>>
) {
  await prisma.$transaction([
    prisma.costSimulation.updateMany({ where: { routeId }, data: { isSelected: false } }),
    prisma.costSimulation.update({ where: { id: costSimulationId }, data: { isSelected: true } }),
    prisma.route.update({ where: { id: routeId }, data: { carrierId, status: "assigned" } }),
    // Trazabilidad — Fase 8: "Toda sugerencia queda registrada... para
    // poder auditar después por qué se tomó una decisión distinta a la
    // más barata". Aquí se audita la decisión automática en sí, con el
    // desglose completo de la puntuación, no solo el resultado.
    prisma.auditLog.create({
      data: {
        companyId: null as any,
        userId: null as any,
        entityName: "route",
        entityId: routeId,
        action: "update",
        oldValue: {},
        newValue: {
          autoAssigned: true,
          costSimulationId,
          carrierId,
          confidence: result.confidence,
          marginOverSecond: result.marginOverSecond,
          breakdown: result.selected?.breakdown,
        },
      },
    }),
  ]);
}
