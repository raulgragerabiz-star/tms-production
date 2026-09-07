import { describe, expect, it } from "vitest";
import {
  applySurcharges,
  computeSurchargeAmount,
  isSurchargeApplicable,
  resolveBaseRate,
  Surcharge,
} from "../lib/rate-engine";

describe("isSurchargeApplicable", () => {
  it("combustible y zona siempre aplican", () => {
    const fuel: Surcharge = { id: "1", surchargeType: "fuel", calculationMode: "percentage", value: 5 };
    const zone: Surcharge = { id: "2", surchargeType: "zone", calculationMode: "fixed", value: 10 };
    expect(isSurchargeApplicable(fuel, {})).toBe(true);
    expect(isSurchargeApplicable(zone, {})).toBe(true);
  });

  it("ADR solo aplica si el pedido lo requiere explícitamente", () => {
    const adr: Surcharge = { id: "3", surchargeType: "adr", calculationMode: "fixed", value: 50 };
    expect(isSurchargeApplicable(adr, {})).toBe(false);
    expect(isSurchargeApplicable(adr, { requiresAdr: false })).toBe(false);
    expect(isSurchargeApplicable(adr, { requiresAdr: true })).toBe(true);
  });

  it("esperas solo aplica si hay horas de espera > 0", () => {
    const waiting: Surcharge = { id: "4", surchargeType: "waiting_time", calculationMode: "per_hour", value: 20 };
    expect(isSurchargeApplicable(waiting, { waitingHours: 0 })).toBe(false);
    expect(isSurchargeApplicable(waiting, { waitingHours: 1.5 })).toBe(true);
  });

  it("festivos solo aplica si la fecha es festivo", () => {
    const holiday: Surcharge = { id: "5", surchargeType: "holiday", calculationMode: "percentage", value: 25 };
    expect(isSurchargeApplicable(holiday, { isHoliday: false })).toBe(false);
    expect(isSurchargeApplicable(holiday, { isHoliday: true })).toBe(true);
  });
});

describe("computeSurchargeAmount", () => {
  it("modo fixed devuelve el valor configurado", () => {
    const s: Surcharge = { id: "1", surchargeType: "adr", calculationMode: "fixed", value: 50 };
    expect(computeSurchargeAmount(s, 200, {})).toBe(50);
  });

  it("modo fixed en peajes usa el importe real informado si existe, no el genérico", () => {
    const s: Surcharge = { id: "1", surchargeType: "toll", calculationMode: "fixed", value: 12 };
    expect(computeSurchargeAmount(s, 200, { tollAmount: 8.5 })).toBe(8.5);
    expect(computeSurchargeAmount(s, 200, {})).toBe(12); // sin importe real, usa el genérico
  });

  it("modo percentage se calcula sobre la base", () => {
    const s: Surcharge = { id: "1", surchargeType: "fuel", calculationMode: "percentage", value: 5 };
    expect(computeSurchargeAmount(s, 200, {})).toBe(10);
  });

  it("modo per_km multiplica por los km del viaje", () => {
    const s: Surcharge = { id: "1", surchargeType: "zone", calculationMode: "per_km", value: 0.1 };
    expect(computeSurchargeAmount(s, 0, { km: 150 })).toBeCloseTo(15);
  });

  it("modo per_hour multiplica por las horas de espera", () => {
    const s: Surcharge = { id: "1", surchargeType: "waiting_time", calculationMode: "per_hour", value: 20 };
    expect(computeSurchargeAmount(s, 0, { waitingHours: 2 })).toBe(40);
  });
});

describe("applySurcharges", () => {
  const surcharges: Surcharge[] = [
    { id: "fuel", surchargeType: "fuel", calculationMode: "percentage", value: 5 },
    { id: "adr", surchargeType: "adr", calculationMode: "fixed", value: 50 },
    { id: "holiday", surchargeType: "holiday", calculationMode: "percentage", value: 25 },
  ];

  it("solo suma los suplementos aplicables, ignorando los que no aplican", () => {
    const result = applySurcharges(200, surcharges, { requiresAdr: false, isHoliday: false });
    // solo combustible aplica: 200 + 5% de 200 = 210
    expect(result.total).toBe(210);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].surchargeType).toBe("fuel");
  });

  it("acumula varios suplementos aplicables sobre la misma base", () => {
    const result = applySurcharges(200, surcharges, { requiresAdr: true, isHoliday: true });
    // 200 (fuel 5%=10) + (adr fijo 50) + (holiday 25% de 200 base =50) = 310
    expect(result.total).toBe(310);
    expect(result.lines).toHaveLength(3);
  });

  it("con lista de suplementos vacía, el total es igual a la base", () => {
    const result = applySurcharges(150, [], {});
    expect(result.total).toBe(150);
    expect(result.lines).toHaveLength(0);
  });
});

describe("resolveBaseRate", () => {
  it("prioriza la tarifa por cliente sobre zona y general", () => {
    const winner = resolveBaseRate({
      customer: { kind: "customer", amount: 100, id: "c1" },
      zone: { kind: "zone", amount: 120, id: "z1" },
      general: { kind: "general", amount: 150, id: "g1" },
    });
    expect(winner.kind).toBe("customer");
    expect(winner.amount).toBe(100);
  });

  it("si no hay tarifa de cliente, prioriza zona sobre general", () => {
    const winner = resolveBaseRate({
      zone: { kind: "zone", amount: 120, id: "z1" },
      general: { kind: "general", amount: 150, id: "g1" },
    });
    expect(winner.kind).toBe("zone");
  });

  it("si solo hay tarifa general, la usa", () => {
    const winner = resolveBaseRate({ general: { kind: "general", amount: 150, id: "g1" } });
    expect(winner.kind).toBe("general");
  });

  it("lanza un error si no hay ninguna tarifa base disponible", () => {
    expect(() => resolveBaseRate({})).toThrow();
  });
});
