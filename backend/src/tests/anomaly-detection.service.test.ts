import {
  detectOrderWeightAnomaly,
  detectSettlementAmountAnomaly,
  detectLowRouteOccupancy,
  detectInefficientRouteDistance,
} from "../modules/intelligence/anomaly-detection.service";

describe("detectOrderWeightAnomaly", () => {
  it("no marca anomalía si no hay histórico suficiente (cliente nuevo)", () => {
    const result = detectOrderWeightAnomaly({
      observedWeightKg: 5000,
      historicalAvgWeightKg: 100,
      historicalStdDevWeightKg: 20,
      minHistoricalSamples: 5,
      sampleCount: 2,
    });
    expect(result.isAnomaly).toBe(false);
  });

  it("no marca anomalía si el peso está dentro de lo habitual", () => {
    const result = detectOrderWeightAnomaly({
      observedWeightKg: 110,
      historicalAvgWeightKg: 100,
      historicalStdDevWeightKg: 20,
      minHistoricalSamples: 5,
      sampleCount: 10,
    });
    expect(result.isAnomaly).toBe(false);
  });

  it("marca severidad media entre 2 y 3.5 desviaciones típicas", () => {
    const result = detectOrderWeightAnomaly({
      observedWeightKg: 145, // (145-100)/20 = 2.25 desviaciones
      historicalAvgWeightKg: 100,
      historicalStdDevWeightKg: 20,
      minHistoricalSamples: 5,
      sampleCount: 10,
    });
    expect(result.isAnomaly).toBe(true);
    expect(result.severity).toBe("medium");
  });

  it("marca severidad alta por encima de 3.5 desviaciones típicas", () => {
    const result = detectOrderWeightAnomaly({
      observedWeightKg: 200, // (200-100)/20 = 5 desviaciones
      historicalAvgWeightKg: 100,
      historicalStdDevWeightKg: 20,
      minHistoricalSamples: 5,
      sampleCount: 10,
    });
    expect(result.isAnomaly).toBe(true);
    expect(result.severity).toBe("high");
    expect(result.expectedRange).toContain("kg");
  });

  it("usa el fallback de margen fijo (20%) cuando la desviación típica histórica es 0", () => {
    const noAnomaly = detectOrderWeightAnomaly({
      observedWeightKg: 105,
      historicalAvgWeightKg: 100,
      historicalStdDevWeightKg: 0,
      minHistoricalSamples: 5,
      sampleCount: 10,
    });
    expect(noAnomaly.isAnomaly).toBe(false);

    const anomaly = detectOrderWeightAnomaly({
      observedWeightKg: 150,
      historicalAvgWeightKg: 100,
      historicalStdDevWeightKg: 0,
      minHistoricalSamples: 5,
      sampleCount: 10,
    });
    expect(anomaly.isAnomaly).toBe(true);
  });
});

describe("detectSettlementAmountAnomaly", () => {
  it("no marca anomalía sin muestra comparable suficiente", () => {
    const result = detectSettlementAmountAnomaly({
      observedAmount: 900,
      comparableAvgAmount: 300,
      comparableStdDevAmount: 50,
      comparableSampleCount: 2,
      minComparableSamples: 5,
    });
    expect(result.isAnomaly).toBe(false);
  });

  it("marca anomalía cuando el importe se desvía mucho de envíos comparables", () => {
    const result = detectSettlementAmountAnomaly({
      observedAmount: 900,
      comparableAvgAmount: 300,
      comparableStdDevAmount: 50,
      comparableSampleCount: 10,
      minComparableSamples: 5,
    });
    expect(result.isAnomaly).toBe(true);
    expect(result.severity).toBe("high");
    expect(result.description).toContain("suplemento no capturado");
  });
});

describe("detectLowRouteOccupancy", () => {
  it("no marca anomalía si no hay rutas suficientes en la ventana", () => {
    const result = detectLowRouteOccupancy({
      avgWeightOccupancyPct: 15,
      avgPalletOccupancyPct: 10,
      routeCount: 2,
      minRouteCount: 5,
    });
    expect(result.isAnomaly).toBe(false);
  });

  it("no marca anomalía si la ocupación está por encima del umbral", () => {
    const result = detectLowRouteOccupancy({
      avgWeightOccupancyPct: 65,
      avgPalletOccupancyPct: 70,
      routeCount: 10,
      minRouteCount: 5,
    });
    expect(result.isAnomaly).toBe(false);
  });

  it("marca severidad alta si la ocupación máxima es menor del 20%", () => {
    const result = detectLowRouteOccupancy({
      avgWeightOccupancyPct: 12,
      avgPalletOccupancyPct: 18,
      routeCount: 8,
      minRouteCount: 5,
    });
    expect(result.isAnomaly).toBe(true);
    expect(result.severity).toBe("high");
  });

  it("marca severidad media si la ocupación máxima está entre 20% y el umbral", () => {
    const result = detectLowRouteOccupancy({
      avgWeightOccupancyPct: 25,
      avgPalletOccupancyPct: 30,
      routeCount: 8,
      minRouteCount: 5,
    });
    expect(result.isAnomaly).toBe(true);
    expect(result.severity).toBe("medium");
  });
});

describe("detectInefficientRouteDistance", () => {
  it("no marca anomalía si no hay rutas suficientes en la ventana", () => {
    const result = detectInefficientRouteDistance({
      avgDeviationPct: 50,
      routeCount: 3,
      minRouteCount: 5,
    });
    expect(result.isAnomaly).toBe(false);
  });

  it("no marca anomalía si la desviación media está por debajo del umbral", () => {
    const result = detectInefficientRouteDistance({
      avgDeviationPct: 8,
      routeCount: 10,
      minRouteCount: 5,
    });
    expect(result.isAnomaly).toBe(false);
  });

  it("no marca anomalía si la distancia real es MENOR que la planificada (ahorro, no problema)", () => {
    const result = detectInefficientRouteDistance({
      avgDeviationPct: -15, // recorrió menos de lo planificado
      routeCount: 10,
      minRouteCount: 5,
    });
    expect(result.isAnomaly).toBe(false);
  });

  it("marca severidad media entre 20% y 40% de desviación media", () => {
    const result = detectInefficientRouteDistance({
      avgDeviationPct: 28,
      routeCount: 10,
      minRouteCount: 5,
    });
    expect(result.isAnomaly).toBe(true);
    expect(result.severity).toBe("medium");
  });

  it("marca severidad alta por encima del 40% de desviación media", () => {
    const result = detectInefficientRouteDistance({
      avgDeviationPct: 55,
      routeCount: 10,
      minRouteCount: 5,
    });
    expect(result.isAnomaly).toBe(true);
    expect(result.severity).toBe("high");
    expect(result.description).toContain("secuenciación geográfica");
  });
});
