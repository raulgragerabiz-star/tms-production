import { ServiceType } from "@prisma/client";

/**
 * Motor de inteligencia (3/3): "el sistema no solo sugiere sino que asigna
 * automáticamente transportista cuando la confianza del modelo supera un
 * umbral configurable y no hay restricciones duras en conflicto".
 *
 * Las restricciones duras (ventana horaria, compatibilidad de segmento,
 * peso/palés) YA se filtran en la capa de generación de candidatos del
 * motor de optimización (POST /optimization/:routeId/simulate) -- todo
 * candidato que llega aquí ya las cumple. Lo que decide ESTA capa es, de
 * entre los candidatos válidos, cuál es "el más óptimo" -- no
 * necesariamente el más barato, sino el que mejor equilibra coste y
 * fiabilidad de distancia según lo que pide el pedido concreto:
 * "compensar distancias y economía en base a características de pedido".
 *
 * Este fichero es puro (sin acceso a base de datos) a propósito -- son
 * funciones de puntuación que se pueden revisar y testear sin depender de
 * Prisma ni de una conexión real. La carga de datos y el efecto (asignar de
 * verdad) viven en auto-optimization.orchestrator.ts.
 */

export interface CandidateForScoring {
  costSimulationId: string;
  carrierId: string;
  estimatedCost: number;
  weightOccupancyPct: number; // 0-100
  palletOccupancyPct: number; // 0-100
  carrierAvgDistanceDeviationPct: number | null; // media histórica (real-planificada)/planificada del transportista; null = sin histórico
  carrierRecentAnomalyCount: number; // alertas pendientes de ese transportista en los últimos 30 días
}

export interface OrderContextForScoring {
  segment: ServiceType;
  leadTimeDays: number;
  requiresAdr: boolean;
}

export interface WeightProfile {
  costWeight: number;
  distanceWeight: number;
  occupancyWeight: number;
}

/**
 * Perfil de pesos según características del pedido -- "en base a
 * características de pedido":
 *
 * - Pedido urgente (leadTimeDays <= 1): la fiabilidad de llegar a tiempo
 *   importa más que ahorrar unos euros -- se prioriza el histórico de
 *   distancia (proxy de puntualidad/previsibilidad) sobre el coste.
 * - Gran volumen (vehículo dedicado): el coste es la palanca dominante --
 *   la variabilidad de ruta pesa menos que en consolidado.
 * - Resto (paquetería/paletería/paletería pesada, no urgente): perfil
 *   equilibrado.
 *
 * `requiresAdr` no cambia los pesos -- actúa como multiplicador de
 * penalización por anomalías (ver `applyAnomalyPenalty`), porque con ADR lo
 * que importa no es el equilibrio coste/distancia sino la fiabilidad
 * general del transportista. De momento el pedido no modela ADR todavía
 * (ver orchestrator), así que este multiplicador queda inactivo en la
 * práctica hasta que exista ese dato.
 */
export function getWeightProfile(orderContext: OrderContextForScoring): WeightProfile {
  if (orderContext.leadTimeDays <= 1) {
    return { costWeight: 0.3, distanceWeight: 0.5, occupancyWeight: 0.2 };
  }
  if (orderContext.segment === ServiceType.gran_volumen) {
    return { costWeight: 0.6, distanceWeight: 0.25, occupancyWeight: 0.15 };
  }
  return { costWeight: 0.5, distanceWeight: 0.3, occupancyWeight: 0.2 };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** 1 = el más barato de la lista, 0 = el más caro -- normalizado dentro del propio conjunto de candidatos. */
function normalizeCost(cost: number, minCost: number, maxCost: number): number {
  if (maxCost === minCost) return 1;
  return clamp01((maxCost - cost) / (maxCost - minCost));
}

/**
 * 1 = el transportista cumple su distancia planificada o la mejora, 0 = se
 * desvía un 50% o más. Sin histórico (transportista nuevo, o sin rutas
 * cerradas todavía con distancia real registrada) se asigna un valor
 * neutro, ni penaliza ni premia.
 */
function distanceReliabilityScore(avgDeviationPct: number | null): number {
  if (avgDeviationPct == null) return 0.5;
  if (avgDeviationPct <= 0) return 1; // cumple o mejora la distancia planificada
  return clamp01(1 - avgDeviationPct / 50);
}

/**
 * Premia ocupación alta hasta un objetivo del 85% (buen aprovechamiento sin
 * frisar el límite físico); por encima de ahí no suma más -- un 100% de
 * ocupación no es "mejor" que un 90%, es simplemente más ajustado.
 */
function occupancyFitScore(weightPct: number, palletPct: number): number {
  const avg = (weightPct + palletPct) / 2;
  return clamp01(avg / 85);
}

/** Cada alerta pendiente resta un 15% de confianza, con suelo del 30% para no anular por completo a un candidato con una única alerta menor. */
function applyAnomalyPenalty(score: number, anomalyCount: number): number {
  const penalized = score * Math.max(0.3, 1 - 0.15 * anomalyCount);
  return clamp01(penalized);
}

export interface CandidateScore {
  costSimulationId: string;
  carrierId: string;
  score: number;
  breakdown: {
    costScore: number;
    distanceScore: number;
    occupancyScore: number;
    weightsUsed: WeightProfile;
    anomalyPenaltyApplied: boolean;
  };
}

export function scoreCandidates(
  candidates: CandidateForScoring[],
  orderContext: OrderContextForScoring
): CandidateScore[] {
  if (candidates.length === 0) return [];

  const weights = getWeightProfile(orderContext);
  const costs = candidates.map((c) => c.estimatedCost);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);

  return candidates.map((c) => {
    const costScore = normalizeCost(c.estimatedCost, minCost, maxCost);
    const distanceScore = distanceReliabilityScore(c.carrierAvgDistanceDeviationPct);
    const occupancyScore = occupancyFitScore(c.weightOccupancyPct, c.palletOccupancyPct);

    const rawScore =
      weights.costWeight * costScore +
      weights.distanceWeight * distanceScore +
      weights.occupancyWeight * occupancyScore;

    // Con ADR, la penalización por anomalías se aplica al doble de fuerza --
    // la fiabilidad importa más que en un envío estándar.
    const anomalyMultiplier = orderContext.requiresAdr ? 2 : 1;
    const finalScore = applyAnomalyPenalty(rawScore, c.carrierRecentAnomalyCount * anomalyMultiplier);

    return {
      costSimulationId: c.costSimulationId,
      carrierId: c.carrierId,
      score: finalScore,
      breakdown: {
        costScore,
        distanceScore,
        occupancyScore,
        weightsUsed: weights,
        anomalyPenaltyApplied: c.carrierRecentAnomalyCount > 0,
      },
    };
  });
}

export interface AutoSelectionResult {
  selected: CandidateScore | null;
  confidence: number;
  marginOverSecond: number | null;
  reason: string;
}

const MIN_MARGIN_OVER_SECOND = 0.05; // evita auto-asignar en empates técnicos, mejor que decida un humano

/**
 * Selecciona el mejor candidato SOLO si su confianza supera el umbral
 * configurado por la empresa Y saca una ventaja mínima sobre el segundo
 * mejor -- un resultado muy reñido entre dos transportistas es exactamente
 * el caso donde el criterio humano aporta más que el automatismo.
 */
export function selectBestCandidateAutomatically(
  candidates: CandidateForScoring[],
  orderContext: OrderContextForScoring,
  minConfidence: number
): AutoSelectionResult {
  const scored = scoreCandidates(candidates, orderContext).sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { selected: null, confidence: 0, marginOverSecond: null, reason: "no_candidates" };
  }

  const top = scored[0];
  const second = scored[1] ?? null;
  const marginOverSecond = second ? top.score - second.score : null;

  if (top.score < minConfidence) {
    return {
      selected: null,
      confidence: top.score,
      marginOverSecond,
      reason: `confidence_below_threshold (${top.score.toFixed(2)} < ${minConfidence.toFixed(2)})`,
    };
  }

  if (second && marginOverSecond! < MIN_MARGIN_OVER_SECOND) {
    return {
      selected: null,
      confidence: top.score,
      marginOverSecond,
      reason: `insufficient_margin_over_second_best (${marginOverSecond!.toFixed(3)})`,
    };
  }

  return { selected: top, confidence: top.score, marginOverSecond, reason: "auto_assigned" };
}
