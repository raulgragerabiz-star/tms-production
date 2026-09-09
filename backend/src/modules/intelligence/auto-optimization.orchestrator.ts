// Motor de inteligencia (3/3): auto-optimización de rutas -- orquestación
// (carga de datos + efecto). Se invoca justo después de que
// POST /optimization/:routeId/simulate deje la ruta en estado "optimized"
// (ver optimization.routes.ts) -- ese es el punto de enganche natural,
// justo cuando ya existen los `cost_simulation` que hay que puntuar.
//
// Puntuación pura (sin acceso a BD) en auto-optimization.service.ts. Aquí
// solo se cargan los datos que esa puntuación necesita y, si el mejor
// candidato es lo bastante bueno, se aplica -- reutilizando exactamente la
// misma transacción que ya usa la selección manual
// (POST /optimization/:routeId/select/:costSimulationId), nunca duplicada.
import { ServiceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  scoreCandidates,
  selectBestCandidateAutomatically,
  CandidateForScoring,
  OrderContextForScoring,
  AutoSelectionResult,
} from "./auto-optimization.service";

export interface AutoAssignOutcome {
  autoAssigned: boolean;
  routeId: string;
  confidence: number | null;
  reason: string;
  costSimulationId?: string;
  carrierId?: string;
}

const RECENT_ANOMALY_WINDOW_DAYS = 30;
const DISTANCE_HISTORY_WINDOW_DAYS = 14;

export async function attemptAutoAssign(routeId: string): Promise<AutoAssignOutcome> {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: {
      company: { select: { autoAssignEnabled: true, autoAssignMinConfidence: true } },
      stops: {
        include: {
          order: { select: { serviceType: true, requestedDeliveryDate: true, createdAt: true } },
        },
      },
    },
  });

  if (!route) {
    return { autoAssigned: false, routeId, confidence: null, reason: "route_not_found" };
  }

  if (!route.company.autoAssignEnabled) {
    return { autoAssigned: false, routeId, confidence: null, reason: "auto_assign_disabled_for_company" };
  }

  // Doble comprobación defensiva: esta función solo tiene sentido justo
  // después de /simulate, que acaba de dejar la ruta en "optimized". Si en
  // el futuro se invocase desde otro sitio, nunca debe tocar una ruta que
  // ya está confirmada o en manos del transportista/conductor.
  if (route.status !== "optimized") {
    return {
      autoAssigned: false,
      routeId,
      confidence: null,
      reason: `route_not_in_optimized_status (${route.status})`,
    };
  }

  const orderContext = buildOrderContext(
    route.serviceType,
    route.stops.map((s) => s.order)
  );

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

  await applySelection(routeId, result.selected.costSimulationId, result.selected.carrierId, route.companyId, result);

  return {
    autoAssigned: true,
    routeId,
    confidence: result.confidence,
    reason: result.reason,
    costSimulationId: result.selected.costSimulationId,
    carrierId: result.selected.carrierId,
  };
}

function buildOrderContext(
  routeServiceType: ServiceType,
  orders: { serviceType: ServiceType | null; requestedDeliveryDate: Date; createdAt: Date }[]
): OrderContextForScoring {
  // leadTimeDays = el más urgente de todos los pedidos de la ruta manda --
  // una ruta con un pedido urgente entre varios no urgentes se trata como
  // urgente. El segmento se toma de la propia ruta (route.serviceType, ya
  // obligatorio en el modelo) en vez de inferirlo de los pedidos.
  const leadTimeDays = orders.length
    ? Math.min(...orders.map((o) => businessDaysBetween(o.createdAt, o.requestedDeliveryDate)))
    : 99;

  // ADR/equipamiento especial todavía no se modela a nivel de pedido (el
  // maestro de vehículos sí tiene equipamiento, pero el pedido no tiene un
  // campo "requiere ADR" -- deliberadamente pospuesto). Se trata siempre
  // como "no exige ADR" hasta que exista ese dato; el multiplicador de
  // penalización por anomalías queda simplemente inactivo mientras tanto,
  // sin romper la puntuación del resto de candidatos.
  return { segment: routeServiceType, leadTimeDays, requiresAdr: false };
}

function businessDaysBetween(from: Date, to: Date): number {
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
  const totalWeightKg = Number(loadPlan?.totalWeightKg ?? 0);
  const totalPallets = Number(loadPlan?.totalPallets ?? 0);

  // Fiabilidad de distancia por transportista -- mismo criterio que el
  // detector de anomalías (anomaly-detection.service.ts, "distancia real vs.
  // planificada"), reutilizado aquí como señal continua: no hace falta que
  // haya cruzado el umbral de alerta para que la desviación influya en la
  // puntuación. Consulta Prisma normal (sin $queryRaw) + agregación en JS --
  // así cada campo se puede revisar contra schema.prisma sin depender de una
  // base de datos real para probarlo.
  const closedRoutes = carrierIds.length
    ? await prisma.route.findMany({
        where: {
          companyId,
          carrierId: { in: carrierIds },
          status: "closed",
          routeDate: { gte: new Date(Date.now() - DISTANCE_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
          distancePlannedKm: { not: null },
          distanceRealKm: { not: null },
        },
        select: { carrierId: true, distancePlannedKm: true, distanceRealKm: true },
      })
    : [];

  const deviationsByCarrier = new Map<string, number[]>();
  for (const r of closedRoutes) {
    if (!r.carrierId) continue;
    const planned = Number(r.distancePlannedKm);
    if (!(planned > 0)) continue;
    const deviationPct = ((Number(r.distanceRealKm) - planned) / planned) * 100;
    const list = deviationsByCarrier.get(r.carrierId) ?? [];
    list.push(deviationPct);
    deviationsByCarrier.set(r.carrierId, list);
  }
  const avgDeviationByCarrier = new Map<string, number>();
  for (const [carrierId, values] of deviationsByCarrier) {
    avgDeviationByCarrier.set(carrierId, values.reduce((a, v) => a + v, 0) / values.length);
  }

  // Alertas pendientes del transportista en los últimos 30 días. Se filtra
  // también por entityName: "carrier" (además de entityId) -- confirmado en
  // anomaly-detection.service.ts que ese es el entityName real que usan
  // low_route_occupancy/inefficient_route_distance, mismo patrón que
  // audit_log; sin este filtro un entityId coincidente de otra entidad
  // contaminaría el recuento.
  const anomalyCounts = carrierIds.length
    ? await prisma.anomalyAlert.groupBy({
        by: ["entityId"],
        where: {
          companyId,
          entityName: "carrier",
          entityId: { in: carrierIds },
          status: "pending",
          detectedAt: { gte: new Date(Date.now() - RECENT_ANOMALY_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
        },
        _count: { id: true },
      })
    : [];
  const anomalyCountByCarrier = new Map(anomalyCounts.map((a) => [a.entityId, a._count.id]));

  return simulations.map((s) => ({
    costSimulationId: s.id,
    carrierId: s.carrierId,
    estimatedCost: Number(s.estimatedCost),
    weightOccupancyPct: s.vehicleType?.maxWeightKg
      ? Math.min(100, (totalWeightKg / Number(s.vehicleType.maxWeightKg)) * 100)
      : 0,
    palletOccupancyPct: s.vehicleType?.maxPallets
      ? Math.min(100, (totalPallets / s.vehicleType.maxPallets) * 100)
      : 0,
    carrierAvgDistanceDeviationPct: avgDeviationByCarrier.get(s.carrierId) ?? null,
    carrierRecentAnomalyCount: anomalyCountByCarrier.get(s.carrierId) ?? 0,
  }));
}

async function applySelection(
  routeId: string,
  costSimulationId: string,
  carrierId: string,
  companyId: string,
  result: AutoSelectionResult
) {
  // Misma transacción que el endpoint de selección manual ya existente
  // (POST /optimization/:routeId/select/:costSimulationId) -- no se
  // duplica lógica de negocio, solo se decide de forma automática CUÁL
  // simulación seleccionar.
  await prisma.$transaction([
    prisma.costSimulation.updateMany({ where: { routeId }, data: { isSelected: false } }),
    prisma.costSimulation.update({ where: { id: costSimulationId }, data: { isSelected: true } }),
    prisma.route.update({ where: { id: routeId }, data: { carrierId, status: "assigned" } }),
    // Trazabilidad de la decisión automática, con el desglose completo de la
    // puntuación -- para poder auditar después por qué se asignó ese
    // transportista y no otro, sin depender de que alguien lo recuerde.
    prisma.auditLog.create({
      data: {
        companyId,
        entityName: "route",
        entityId: routeId,
        action: "update",
        oldValue: {},
        // `as any`: mismo motivo que costBreakdown en optimization.routes.ts
        // -- el campo Json de Prisma exige un objeto plano (InputJsonValue),
        // y `breakdown` viaja con un tipo con nombre (WeightProfile) que
        // TypeScript no reconoce estructuralmente como tal aunque en tiempo
        // de ejecución sea un objeto corriente serializable sin problema.
        newValue: {
          autoAssigned: true,
          costSimulationId,
          carrierId,
          confidence: result.confidence,
          marginOverSecond: result.marginOverSecond,
          breakdown: result.selected?.breakdown,
        } as any,
      },
    }),
  ]);
}
