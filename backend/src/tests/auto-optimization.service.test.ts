import { ServiceSegment } from "@prisma/client";
import {
  getWeightProfile,
  scoreCandidates,
  selectBestCandidateAutomatically,
  CandidateForScoring,
  OrderContextForScoring,
} from "../modules/intelligence/auto-optimization.service";

const cheapButUnreliable: CandidateForScoring = {
  costSimulationId: "sim-cheap",
  carrierId: "carrier-cheap",
  estimatedCost: 100,
  weightOccupancyPct: 70,
  palletOccupancyPct: 70,
  carrierAvgDistanceDeviationPct: 45, // muy poco fiable en distancia
  carrierRecentAnomalyCount: 0,
};

const expensiveButReliable: CandidateForScoring = {
  costSimulationId: "sim-reliable",
  carrierId: "carrier-reliable",
  estimatedCost: 130, // 30% más caro
  weightOccupancyPct: 75,
  palletOccupancyPct: 75,
  carrierAvgDistanceDeviationPct: -5, // mejora la distancia planificada
  carrierRecentAnomalyCount: 0,
};

describe("getWeightProfile — adaptación a características del pedido", () => {
  it("prioriza distancia/fiabilidad sobre coste en pedidos urgentes", () => {
    const profile = getWeightProfile({ segment: ServiceSegment.paleteria, leadTimeDays: 1, requiresAdr: false });
    expect(profile.distanceWeight).toBeGreaterThan(profile.costWeight);
  });

  it("prioriza economía en camión completo dedicado (gran_volumen)", () => {
    const profile = getWeightProfile({ segment: ServiceSegment.gran_volumen, leadTimeDays: 5, requiresAdr: false });
    expect(profile.costWeight).toBeGreaterThan(profile.distanceWeight);
  });

  it("usa un perfil equilibrado para paletería estándar no urgente", () => {
    const profile = getWeightProfile({ segment: ServiceSegment.paleteria, leadTimeDays: 5, requiresAdr: false });
    expect(profile.costWeight).toBeCloseTo(0.5);
    expect(profile.costWeight + profile.distanceWeight + profile.occupancyWeight).toBeCloseTo(1);
  });
});

describe("scoreCandidates — compensación distancia/economía", () => {
  it("en un pedido URGENTE, el candidato fiable en distancia puede ganar aunque sea más caro", () => {
    const orderContext: OrderContextForScoring = {
      segment: ServiceSegment.paleteria,
      leadTimeDays: 1,
      requiresAdr: false,
    };

    const scored = scoreCandidates([cheapButUnreliable, expensiveButReliable], orderContext);
    const reliable = scored.find((s) => s.carrierId === "carrier-reliable")!;
    const cheap = scored.find((s) => s.carrierId === "carrier-cheap")!;

    expect(reliable.score).toBeGreaterThan(cheap.score);
  });

  it("en un pedido de GRAN VOLUMEN no urgente, el candidato barato gana pese a ser menos fiable en distancia", () => {
    const orderContext: OrderContextForScoring = {
      segment: ServiceSegment.gran_volumen,
      leadTimeDays: 10,
      requiresAdr: false,
    };

    const scored = scoreCandidates([cheapButUnreliable, expensiveButReliable], orderContext);
    const reliable = scored.find((s) => s.carrierId === "carrier-reliable")!;
    const cheap = scored.find((s) => s.carrierId === "carrier-cheap")!;

    expect(cheap.score).toBeGreaterThan(reliable.score);
  });

  it("penaliza a un transportista con alertas de anomalía recientes", () => {
    const withAnomalies: CandidateForScoring = { ...expensiveButReliable, carrierRecentAnomalyCount: 3 };
    const orderContext: OrderContextForScoring = {
      segment: ServiceSegment.paleteria,
      leadTimeDays: 5,
      requiresAdr: false,
    };

    const [withoutPenalty] = scoreCandidates([expensiveButReliable], orderContext);
    const [withPenalty] = scoreCandidates([withAnomalies], orderContext);

    expect(withPenalty.score).toBeLessThan(withoutPenalty.score);
  });

  it("duplica la penalización por anomalías cuando el pedido requiere ADR", () => {
    const withAnomalies: CandidateForScoring = { ...expensiveButReliable, carrierRecentAnomalyCount: 2 };

    const normalOrder: OrderContextForScoring = { segment: ServiceSegment.paleteria, leadTimeDays: 5, requiresAdr: false };
    const adrOrder: OrderContextForScoring = { segment: ServiceSegment.paleteria, leadTimeDays: 5, requiresAdr: true };

    const [normalScore] = scoreCandidates([withAnomalies], normalOrder);
    const [adrScore] = scoreCandidates([withAnomalies], adrOrder);

    expect(adrScore.score).toBeLessThan(normalScore.score);
  });

  it("da un valor neutro (ni penaliza ni premia) a un transportista sin histórico de distancia", () => {
    const noHistory: CandidateForScoring = { ...expensiveButReliable, carrierAvgDistanceDeviationPct: null };
    const orderContext: OrderContextForScoring = { segment: ServiceSegment.paleteria, leadTimeDays: 5, requiresAdr: false };
    const [scored] = scoreCandidates([noHistory], orderContext);
    expect(scored.breakdown.distanceScore).toBe(0.5);
  });
});

describe("selectBestCandidateAutomatically — nunca auto-asigna sin margen claro", () => {
  const orderContext: OrderContextForScoring = { segment: ServiceSegment.paleteria, leadTimeDays: 5, requiresAdr: false };

  it("no selecciona nada si no hay candidatos", () => {
    const result = selectBestCandidateAutomatically([], orderContext, 0.75);
    expect(result.selected).toBeNull();
    expect(result.reason).toBe("no_candidates");
  });

  it("no auto-asigna si la confianza del mejor candidato no alcanza el umbral configurado", () => {
    const lowConfidenceCandidate: CandidateForScoring = {
      costSimulationId: "sim1",
      carrierId: "c1",
      estimatedCost: 100,
      weightOccupancyPct: 20,
      palletOccupancyPct: 20,
      carrierAvgDistanceDeviationPct: 45,
      carrierRecentAnomalyCount: 2,
    };
    const result = selectBestCandidateAutomatically([lowConfidenceCandidate], orderContext, 0.9);
    expect(result.selected).toBeNull();
    expect(result.reason).toContain("confidence_below_threshold");
  });

  it("no auto-asigna si dos candidatos están casi empatados (mejor que decida un humano)", () => {
    const a: CandidateForScoring = { ...expensiveButReliable, costSimulationId: "a", carrierId: "ca" };
    const b: CandidateForScoring = { ...expensiveButReliable, costSimulationId: "b", carrierId: "cb", estimatedCost: 131 };

    const result = selectBestCandidateAutomatically([a, b], orderContext, 0.3);
    expect(result.selected).toBeNull();
    expect(result.reason).toContain("insufficient_margin_over_second_best");
  });

  it("auto-asigna cuando hay un ganador claro por encima del umbral", () => {
    const clearWinner: CandidateForScoring = {
      costSimulationId: "winner",
      carrierId: "carrier-winner",
      estimatedCost: 100,
      weightOccupancyPct: 85,
      palletOccupancyPct: 85,
      carrierAvgDistanceDeviationPct: -10,
      carrierRecentAnomalyCount: 0,
    };
    const weakCandidate: CandidateForScoring = {
      costSimulationId: "weak",
      carrierId: "carrier-weak",
      estimatedCost: 400,
      weightOccupancyPct: 10,
      palletOccupancyPct: 10,
      carrierAvgDistanceDeviationPct: 80,
      carrierRecentAnomalyCount: 4,
    };

    const result = selectBestCandidateAutomatically([clearWinner, weakCandidate], orderContext, 0.5);
    expect(result.selected?.costSimulationId).toBe("winner");
    expect(result.reason).toBe("auto_assigned");
  });
});
