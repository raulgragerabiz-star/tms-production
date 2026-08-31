import { prisma } from "../../lib/prisma";
import { AnomalyType, AnomalySeverity } from "@prisma/client";

/**
 * Documento 16-inteligencia-artificial-TMS.md, "Detección de anomalías":
 * "vigilancia de patrones fuera de lo habitual... generando alerta para
 * revisión humana, no corrección automática". Cada detector es una
 * función pura que recibe ya los datos agregados y devuelve si hay
 * anomalía — la parte de "traer datos de BD" vive en el orquestador
 * (`runAnomalyDetection`), separada a propósito para poder testear la
 * lógica de umbral sin depender de una base de datos real.
 */

export interface WeightAnomalyInput {
  observedWeightKg: number;
  historicalAvgWeightKg: number;
  historicalStdDevWeightKg: number;
  minHistoricalSamples: number;
  sampleCount: number;
}

export interface AnomalyResult {
  isAnomaly: boolean;
  severity: AnomalySeverity | null;
  description: string | null;
  expectedRange: string | null;
}

const DEVIATION_MULTIPLIER_MEDIUM = 2; // (config) desviaciones típicas para severidad media
const DEVIATION_MULTIPLIER_HIGH = 3.5; // (config) desviaciones típicas para severidad alta

/**
 * Documento: "un pedido con peso declarado muy distinto al histórico de
 * ese cliente/producto". Se compara contra media ± N desviaciones típicas
 * del propio cliente — no contra un umbral global, porque un cliente
 * grande (ej. BigMat) puede pedir habitualmente 10x más que uno pequeño;
 * lo relevante es la desviación respecto a SU propio patrón.
 */
export function detectOrderWeightAnomaly(input: WeightAnomalyInput): AnomalyResult {
  if (input.sampleCount < input.minHistoricalSamples) {
    // Sin histórico suficiente para este cliente, no se puede juzgar
    // "distinto de lo habitual" — no es una anomalía, es una novedad.
    return { isAnomaly: false, severity: null, description: null, expectedRange: null };
  }

  if (input.historicalStdDevWeightKg === 0) {
    // Cliente con peso siempre idéntico históricamente — cualquier
    // desviación es potencialmente relevante, pero sin desviación típica
    // no se puede calcular un ratio; se compara contra un 20% de margen
    // fijo como fallback razonable.
    const deviationPct = Math.abs(input.observedWeightKg - input.historicalAvgWeightKg) / input.historicalAvgWeightKg;
    if (deviationPct < 0.2) return { isAnomaly: false, severity: null, description: null, expectedRange: null };
    return {
      isAnomaly: true,
      severity: "medium",
      description: `Peso del pedido (${input.observedWeightKg}kg) se desvía un ${(deviationPct * 100).toFixed(0)}% del histórico constante del cliente (${input.historicalAvgWeightKg}kg)`,
      expectedRange: `~${input.historicalAvgWeightKg}kg (histórico sin variación)`,
    };
  }

  const deviations =
    Math.abs(input.observedWeightKg - input.historicalAvgWeightKg) / input.historicalStdDevWeightKg;

  if (deviations < DEVIATION_MULTIPLIER_MEDIUM) {
    return { isAnomaly: false, severity: null, description: null, expectedRange: null };
  }

  const severity: AnomalySeverity = deviations >= DEVIATION_MULTIPLIER_HIGH ? "high" : "medium";
  const low = (input.historicalAvgWeightKg - 2 * input.historicalStdDevWeightKg).toFixed(0);
  const high = (input.historicalAvgWeightKg + 2 * input.historicalStdDevWeightKg).toFixed(0);

  return {
    isAnomaly: true,
    severity,
    description: `Peso del pedido (${input.observedWeightKg}kg) se desvía ${deviations.toFixed(1)} desviaciones típicas del histórico de este cliente (media ${input.historicalAvgWeightKg.toFixed(0)}kg)`,
    expectedRange: `${low}-${high} kg (media ± 2 desviaciones)`,
  };
}

export interface SettlementAnomalyInput {
  observedAmount: number;
  comparableAvgAmount: number;
  comparableStdDevAmount: number;
  comparableSampleCount: number;
  minComparableSamples: number;
}

/**
 * Documento: "una liquidación con importe anómalo frente a viajes
 * comparables". "Comparables" se resuelve en el orquestador como envíos
 * del mismo transportista con peso/distancia similar — aquí solo se
 * juzga el ratio ya calculado.
 */
export function detectSettlementAmountAnomaly(input: SettlementAnomalyInput): AnomalyResult {
  if (input.comparableSampleCount < input.minComparableSamples || input.comparableStdDevAmount === 0) {
    return { isAnomaly: false, severity: null, description: null, expectedRange: null };
  }

  const deviations =
    Math.abs(input.observedAmount - input.comparableAvgAmount) / input.comparableStdDevAmount;

  if (deviations < DEVIATION_MULTIPLIER_MEDIUM) {
    return { isAnomaly: false, severity: null, description: null, expectedRange: null };
  }

  const severity: AnomalySeverity = deviations >= DEVIATION_MULTIPLIER_HIGH ? "high" : "medium";
  const low = (input.comparableAvgAmount - 2 * input.comparableStdDevAmount).toFixed(2);
  const high = (input.comparableAvgAmount + 2 * input.comparableStdDevAmount).toFixed(2);

  return {
    isAnomaly: true,
    severity,
    description: `Importe liquidado (${input.observedAmount.toFixed(2)}€) se desvía ${deviations.toFixed(1)} desviaciones típicas de envíos comparables (media ${input.comparableAvgAmount.toFixed(2)}€) — posible suplemento no capturado en tarifa configurada`,
    expectedRange: `${low}€-${high}€ (media ± 2 desviaciones)`,
  };
}

export interface OccupancyAnomalyInput {
  avgWeightOccupancyPct: number;
  avgPalletOccupancyPct: number;
  routeCount: number;
  minRouteCount: number;
}

const LOW_OCCUPANCY_THRESHOLD_PCT = 40; // (config)

/**
 * Documento: "una ruta con ocupación reiteradamente baja". Se evalúa
 * sobre una media móvil de N rutas del mismo transportista/tipo de
 * vehículo, NO sobre una ruta puntual — una ruta baja de ocupación un día
 * concreto no es anómala por sí sola, un patrón sostenido sí lo es (señal
 * para retroalimentar la configuración de zonas/consolidación, tal como
 * pide el documento en "Detección de rutas ineficientes").
 */
export function detectLowRouteOccupancy(input: OccupancyAnomalyInput): AnomalyResult {
  if (input.routeCount < input.minRouteCount) {
    return { isAnomaly: false, severity: null, description: null, expectedRange: null };
  }

  const maxOccupancy = Math.max(input.avgWeightOccupancyPct, input.avgPalletOccupancyPct);
  if (maxOccupancy >= LOW_OCCUPANCY_THRESHOLD_PCT) {
    return { isAnomaly: false, severity: null, description: null, expectedRange: null };
  }

  const severity: AnomalySeverity = maxOccupancy < 20 ? "high" : "medium";

  return {
    isAnomaly: true,
    severity,
    description: `Ocupación media reiteradamente baja en las últimas ${input.routeCount} rutas: ${maxOccupancy.toFixed(0)}% (peso ${input.avgWeightOccupancyPct.toFixed(0)}%, palés ${input.avgPalletOccupancyPct.toFixed(0)}%)`,
    expectedRange: `>= ${LOW_OCCUPANCY_THRESHOLD_PCT}%`,
  };
}

export interface RouteDistanceAnomalyInput {
  avgDeviationPct: number; // media de ((distancia_real - distancia_planificada) / distancia_planificada) * 100
  routeCount: number;
  minRouteCount: number;
}

const DISTANCE_DEVIATION_THRESHOLD_MEDIUM_PCT = 20; // (config)
const DISTANCE_DEVIATION_THRESHOLD_HIGH_PCT = 40; // (config)

/**
 * Documento 16-inteligencia-artificial-TMS.md, "Detección de rutas
 * ineficientes": "análisis retrospectivo de rutas con desviación relevante
 * entre distancia optimizada y distancia real recorrida... para
 * retroalimentar la configuración de zonas/consolidación". Mismo patrón
 * de media móvil que `detectLowRouteOccupancy` — una ruta puntual con
 * desvío (tráfico puntual, desvío por obra) no es señal de nada; un
 * patrón sostenido en el mismo transportista sí lo es (puede indicar que
 * la secuenciación geográfica no está reflejando bien su zona real de
 * cobertura, o que el transportista no sigue la ruta sugerida).
 *
 * Reutiliza directamente `distance_planned_km`/`distance_real_km` ya
 * añadidas a `Route` en la pasada 5 (KPIs) — sin este detector, esas dos
 * columnas solo alimentaban el KPI `distanceDeviationPct` de forma
 * pasiva; aquí se convierten en alerta activa cuando el patrón lo
 * justifica.
 */
export function detectInefficientRouteDistance(input: RouteDistanceAnomalyInput): AnomalyResult {
  if (input.routeCount < input.minRouteCount) {
    return { isAnomaly: false, severity: null, description: null, expectedRange: null };
  }

  // Solo interesa el exceso (distancia real > planificada) — un ahorro de
  // distancia respecto a lo planificado no es un problema a alertar.
  if (input.avgDeviationPct < DISTANCE_DEVIATION_THRESHOLD_MEDIUM_PCT) {
    return { isAnomaly: false, severity: null, description: null, expectedRange: null };
  }

  const severity: AnomalySeverity =
    input.avgDeviationPct >= DISTANCE_DEVIATION_THRESHOLD_HIGH_PCT ? "high" : "medium";

  return {
    isAnomaly: true,
    severity,
    description: `Distancia real supera reiteradamente la planificada en las últimas ${input.routeCount} rutas: +${input.avgDeviationPct.toFixed(0)}% de media — revisar secuenciación geográfica o cumplimiento de ruta sugerida`,
    expectedRange: `< ${DISTANCE_DEVIATION_THRESHOLD_MEDIUM_PCT}% de desviación`,
  };
}

// ============================================================================
// Orquestador — trae datos reales de BD y persiste alertas de forma
// idempotente (no duplica una alerta ya pendiente para la misma entidad).
// ============================================================================

const MIN_HISTORICAL_SAMPLES = 5;
const MIN_COMPARABLE_SAMPLES = 5;
const MIN_ROUTE_COUNT_FOR_OCCUPANCY = 5;
const MIN_ROUTE_COUNT_FOR_DISTANCE = 5;

export async function runAnomalyDetection(companyId: string): Promise<{
  weightAnomalies: number;
  settlementAnomalies: number;
  occupancyAnomalies: number;
  distanceAnomalies: number;
}> {
  const [weightAnomalies, settlementAnomalies, occupancyAnomalies, distanceAnomalies] = await Promise.all([
    detectAndPersistWeightAnomalies(companyId),
    detectAndPersistSettlementAnomalies(companyId),
    detectAndPersistOccupancyAnomalies(companyId),
    detectAndPersistRouteDistanceAnomalies(companyId),
  ]);

  return { weightAnomalies, settlementAnomalies, occupancyAnomalies, distanceAnomalies };
}

async function persistAlertIfNew(params: {
  companyId: string;
  alertType: AnomalyType;
  entityName: string;
  entityId: string;
  result: AnomalyResult;
  metricValue: number;
}): Promise<boolean> {
  if (!params.result.isAnomaly) return false;

  try {
    await prisma.anomalyAlert.create({
      data: {
        companyId: params.companyId,
        alertType: params.alertType,
        severity: params.result.severity!,
        entityName: params.entityName,
        entityId: params.entityId,
        description: params.result.description!,
        expectedRange: params.result.expectedRange,
        metricValue: params.metricValue,
        status: "pending",
      },
    });
    return true;
  } catch (err: any) {
    // Violación del índice único (companyId, alertType, entityId, status)
    // = ya existe una alerta pendiente idéntica — comportamiento esperado
    // en ejecuciones repetidas del job, no es un error real.
    if (err?.code === "P2002") return false;
    throw err;
  }
}

async function detectAndPersistWeightAnomalies(companyId: string): Promise<number> {
  // Pedidos de las últimas 24h, comparados contra el histórico (30 días
  // previos) del mismo cliente — solo pedidos recientes, para no reevaluar
  // indefinidamente historia ya conocida en cada ejecución del job.
  const recentOrders = await prisma.order.findMany({
    where: { companyId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    select: { id: true, customerId: true, orderLines: { select: { lineWeightKg: true } } },
  });

  let count = 0;
  for (const order of recentOrders) {
    const observedWeightKg = order.orderLines.reduce((sum, l) => sum + Number(l.lineWeightKg ?? 0), 0);

    const stats = await prisma.$queryRaw<{ avg_weight: number; stddev_weight: number; sample_count: bigint }[]>`
      SELECT avg(w.total) AS avg_weight, coalesce(stddev(w.total), 0) AS stddev_weight, count(*) AS sample_count
      FROM (
        SELECT o.id, sum(ol.line_weight_kg) AS total
        FROM "order" o
        JOIN order_line ol ON ol.order_id = o.id
        WHERE o.customer_id = ${order.customerId}
          AND o.id != ${order.id}
          AND o.created_at >= now() - interval '30 days'
        GROUP BY o.id
      ) w
    `;

    const s = stats[0];
    if (!s) continue;

    const result = detectOrderWeightAnomaly({
      observedWeightKg,
      historicalAvgWeightKg: Number(s.avg_weight ?? 0),
      historicalStdDevWeightKg: Number(s.stddev_weight ?? 0),
      minHistoricalSamples: MIN_HISTORICAL_SAMPLES,
      sampleCount: Number(s.sample_count),
    });

    const persisted = await persistAlertIfNew({
      companyId,
      alertType: "order_weight_deviation",
      entityName: "order",
      entityId: order.id,
      result,
      metricValue: observedWeightKg,
    });
    if (persisted) count++;
  }

  return count;
}

async function detectAndPersistSettlementAnomalies(companyId: string): Promise<number> {
  const recentLines = await prisma.settlementLine.findMany({
    where: {
      carrierSettlement: { companyId },
      shipment: { finishedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    },
    select: { id: true, amount: true, shipment: { select: { carrierId: true } } },
  });

  let count = 0;
  for (const line of recentLines) {
    const stats = await prisma.$queryRaw<{ avg_amount: number; stddev_amount: number; sample_count: bigint }[]>`
      SELECT avg(sl.amount) AS avg_amount, coalesce(stddev(sl.amount), 0) AS stddev_amount, count(*) AS sample_count
      FROM settlement_line sl
      JOIN shipment s ON s.id = sl.shipment_id
      WHERE s.carrier_id = ${line.shipment.carrierId}
        AND sl.id != ${line.id}
        AND s.finished_at >= now() - interval '90 days'
    `;

    const s = stats[0];
    if (!s) continue;

    const result = detectSettlementAmountAnomaly({
      observedAmount: Number(line.amount),
      comparableAvgAmount: Number(s.avg_amount ?? 0),
      comparableStdDevAmount: Number(s.stddev_amount ?? 0),
      comparableSampleCount: Number(s.sample_count),
      minComparableSamples: MIN_COMPARABLE_SAMPLES,
    });

    const persisted = await persistAlertIfNew({
      companyId,
      alertType: "settlement_amount_deviation",
      entityName: "settlement_line",
      entityId: line.id,
      result,
      metricValue: Number(line.amount),
    });
    if (persisted) count++;
  }

  return count;
}

async function detectAndPersistOccupancyAnomalies(companyId: string): Promise<number> {
  const carriers = await prisma.carrier.findMany({ where: { companyId, active: true }, select: { id: true } });

  let count = 0;
  for (const carrier of carriers) {
    const stats = await prisma.$queryRaw<
      { avg_weight_pct: number; avg_pallet_pct: number; route_count: bigint }[]
    >`
      SELECT
        avg(lp.weight_occupancy_pct) * 100 AS avg_weight_pct,
        avg(lp.pallet_occupancy_pct) * 100 AS avg_pallet_pct,
        count(*) AS route_count
      FROM load_plan lp
      JOIN route r ON r.id = lp.route_id
      WHERE r.carrier_id = ${carrier.id}
        AND r.company_id = ${companyId}
        AND r.status = 'closed'
        AND r.route_date >= now() - interval '14 days'
    `;

    const s = stats[0];
    if (!s) continue;

    const result = detectLowRouteOccupancy({
      avgWeightOccupancyPct: Number(s.avg_weight_pct ?? 0),
      avgPalletOccupancyPct: Number(s.avg_pallet_pct ?? 0),
      routeCount: Number(s.route_count),
      minRouteCount: MIN_ROUTE_COUNT_FOR_OCCUPANCY,
    });

    const persisted = await persistAlertIfNew({
      companyId,
      alertType: "low_route_occupancy",
      entityName: "carrier",
      entityId: carrier.id,
      result,
      metricValue: Math.max(Number(s.avg_weight_pct ?? 0), Number(s.avg_pallet_pct ?? 0)),
    });
    if (persisted) count++;
  }

  return count;
}

async function detectAndPersistRouteDistanceAnomalies(companyId: string): Promise<number> {
  const carriers = await prisma.carrier.findMany({ where: { companyId, active: true }, select: { id: true } });

  let count = 0;
  for (const carrier of carriers) {
    const stats = await prisma.$queryRaw<{ avg_deviation_pct: number; route_count: bigint }[]>`
      SELECT
        avg(
          CASE WHEN r.distance_planned_km > 0
            THEN ((r.distance_real_km - r.distance_planned_km) / r.distance_planned_km) * 100
            ELSE NULL
          END
        ) AS avg_deviation_pct,
        count(*) FILTER (WHERE r.distance_planned_km > 0 AND r.distance_real_km IS NOT NULL) AS route_count
      FROM route r
      WHERE r.carrier_id = ${carrier.id}
        AND r.company_id = ${companyId}
        AND r.status = 'closed'
        AND r.route_date >= now() - interval '14 days'
    `;

    const s = stats[0];
    if (!s || s.avg_deviation_pct == null) continue; // sin distancia real/planificada poblada todavía, se omite sin error

    const result = detectInefficientRouteDistance({
      avgDeviationPct: Number(s.avg_deviation_pct),
      routeCount: Number(s.route_count),
      minRouteCount: MIN_ROUTE_COUNT_FOR_DISTANCE,
    });

    const persisted = await persistAlertIfNew({
      companyId,
      alertType: "inefficient_route_distance",
      entityName: "carrier",
      entityId: carrier.id,
      result,
      metricValue: Number(s.avg_deviation_pct),
    });
    if (persisted) count++;
  }

  return count;
}
