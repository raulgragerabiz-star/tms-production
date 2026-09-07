import { computeApplicableSurcharges, RateSurchargeLike, SurchargeContext } from "../modules/rates/surcharge.service";

const baseContext: SurchargeContext = {
  baseAmount: 1000,
  totalKm: 250,
  requiresAdr: false,
  isHolidayDate: false,
  waitingMinutes: 0,
  tollAmountActual: null,
  currentFuelIndexValue: null,
};

function surcharge(overrides: Partial<RateSurchargeLike>): RateSurchargeLike {
  return {
    id: "s1",
    surchargeType: "fuel",
    calculationMode: "percentage",
    value: 10,
    baselineValue: null,
    franchiseMinutes: null,
    ...overrides,
  };
}

describe("computeApplicableSurcharges — fuel", () => {
  it("no aplica si no hay índice de combustible configurado", () => {
    const result = computeApplicableSurcharges(
      [surcharge({ surchargeType: "fuel", baselineValue: 1.3 })],
      { ...baseContext, currentFuelIndexValue: null }
    );
    expect(result.items).toHaveLength(0);
  });

  it("aplica proporcionalmente a la desviación del índice respecto al baseline", () => {
    const result = computeApplicableSurcharges(
      [surcharge({ surchargeType: "fuel", value: 10, baselineValue: 1.3 })],
      { ...baseContext, currentFuelIndexValue: 1.43 } // +10% de desviación
    );
    expect(result.items).toHaveLength(1);
    // baseAmount(1000) * 10% * 10% desviación = 10
    expect(result.items[0].amount).toBeCloseTo(10, 1);
  });

  it("no genera línea si la desviación es prácticamente nula", () => {
    const result = computeApplicableSurcharges(
      [surcharge({ surchargeType: "fuel", baselineValue: 1.3 })],
      { ...baseContext, currentFuelIndexValue: 1.30001 }
    );
    expect(result.items).toHaveLength(0);
  });
});

describe("computeApplicableSurcharges — adr", () => {
  it("no aplica si el pedido no requiere ADR", () => {
    const result = computeApplicableSurcharges(
      [surcharge({ surchargeType: "adr", calculationMode: "fixed", value: 50 })],
      { ...baseContext, requiresAdr: false }
    );
    expect(result.items).toHaveLength(0);
  });

  it("aplica importe fijo si el pedido requiere ADR", () => {
    const result = computeApplicableSurcharges(
      [surcharge({ surchargeType: "adr", calculationMode: "fixed", value: 50 })],
      { ...baseContext, requiresAdr: true }
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].amount).toBe(50);
  });

  it("aplica porcentaje sobre el importe base si el modo es percentage", () => {
    const result = computeApplicableSurcharges(
      [surcharge({ surchargeType: "adr", calculationMode: "percentage", value: 5 })],
      { ...baseContext, requiresAdr: true, baseAmount: 1000 }
    );
    expect(result.items[0].amount).toBe(50);
  });
});

describe("computeApplicableSurcharges — holiday", () => {
  it("no aplica en día laborable", () => {
    const result = computeApplicableSurcharges(
      [surcharge({ surchargeType: "holiday", calculationMode: "percentage", value: 20 })],
      { ...baseContext, isHolidayDate: false }
    );
    expect(result.items).toHaveLength(0);
  });

  it("aplica recargo porcentual en festivo", () => {
    const result = computeApplicableSurcharges(
      [surcharge({ surchargeType: "holiday", calculationMode: "percentage", value: 20 })],
      { ...baseContext, isHolidayDate: true, baseAmount: 1000 }
    );
    expect(result.items[0].amount).toBe(200);
  });
});

describe("computeApplicableSurcharges — toll", () => {
  it("usa el importe real si está disponible, no el estimado", () => {
    const result = computeApplicableSurcharges(
      [surcharge({ surchargeType: "toll", calculationMode: "fixed", value: 15 })],
      { ...baseContext, tollAmountActual: 22.5 }
    );
    expect(result.items[0].amount).toBe(22.5);
    expect(result.items[0].detail).toContain("real");
  });

  it("usa el importe estimado configurado si no hay dato real", () => {
    const result = computeApplicableSurcharges(
      [surcharge({ surchargeType: "toll", calculationMode: "fixed", value: 15 })],
      { ...baseContext, tollAmountActual: null }
    );
    expect(result.items[0].amount).toBe(15);
    expect(result.items[0].detail).toContain("estimado");
  });
});

describe("computeApplicableSurcharges — waiting_time", () => {
  it("no aplica si la espera no supera la franquicia", () => {
    const result = computeApplicableSurcharges(
      [surcharge({ surchargeType: "waiting_time", calculationMode: "per_hour", value: 30, franchiseMinutes: 60 })],
      { ...baseContext, waitingMinutes: 45 }
    );
    expect(result.items).toHaveLength(0);
  });

  it("factura solo los minutos que superan la franquicia", () => {
    const result = computeApplicableSurcharges(
      [surcharge({ surchargeType: "waiting_time", calculationMode: "per_hour", value: 30, franchiseMinutes: 60 })],
      { ...baseContext, waitingMinutes: 120 } // 60 min facturables = 1h
    );
    expect(result.items[0].amount).toBe(30);
  });
});

describe("computeApplicableSurcharges — acumulación", () => {
  it("suma varios suplementos aplicables simultáneamente", () => {
    const result = computeApplicableSurcharges(
      [
        surcharge({ id: "adr", surchargeType: "adr", calculationMode: "fixed", value: 50 }),
        surcharge({ id: "holiday", surchargeType: "holiday", calculationMode: "percentage", value: 10 }),
        surcharge({ id: "toll", surchargeType: "toll", calculationMode: "fixed", value: 12 }),
      ],
      { ...baseContext, requiresAdr: true, isHolidayDate: true, baseAmount: 1000 }
    );

    expect(result.items).toHaveLength(3);
    expect(result.totalSurcharges).toBe(50 + 100 + 12);
  });
});
