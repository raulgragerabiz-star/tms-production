import { computeDemandPercentiles, WeeklySample } from "../modules/intelligence/demand-forecast.service";

describe("computeDemandPercentiles", () => {
  it("devuelve todo a cero con muestra vacía, sin lanzar error", () => {
    const result = computeDemandPercentiles([]);
    expect(result).toEqual({ ordersP50: 0, ordersP80: 0, weightKgP50: 0, weightKgP80: 0, sampleSize: 0 });
  });

  it("con una única muestra, P50 y P80 coinciden con el único valor", () => {
    const samples: WeeklySample[] = [{ orderCount: 10, totalWeightKg: 500 }];
    const result = computeDemandPercentiles(samples);
    expect(result.ordersP50).toBe(10);
    expect(result.ordersP80).toBe(10);
    expect(result.sampleSize).toBe(1);
  });

  it("calcula la mediana (P50) correctamente sobre una muestra impar", () => {
    const samples: WeeklySample[] = [
      { orderCount: 5, totalWeightKg: 100 },
      { orderCount: 10, totalWeightKg: 200 },
      { orderCount: 15, totalWeightKg: 300 },
    ];
    const result = computeDemandPercentiles(samples);
    expect(result.ordersP50).toBe(10);
  });

  it("el P80 es siempre >= P50 (mismo dataset, percentil más alto)", () => {
    const samples: WeeklySample[] = Array.from({ length: 12 }).map((_, i) => ({
      orderCount: 5 + i * 2, // 5,7,9,...,27
      totalWeightKg: (5 + i * 2) * 40,
    }));
    const result = computeDemandPercentiles(samples);
    expect(result.ordersP80).toBeGreaterThanOrEqual(result.ordersP50);
    expect(result.weightKgP80).toBeGreaterThanOrEqual(result.weightKgP50);
  });

  it("es insensible al orden de entrada de las muestras", () => {
    const samples: WeeklySample[] = [
      { orderCount: 20, totalWeightKg: 800 },
      { orderCount: 5, totalWeightKg: 100 },
      { orderCount: 12, totalWeightKg: 400 },
    ];
    const shuffled = [samples[2], samples[0], samples[1]];

    const a = computeDemandPercentiles(samples);
    const b = computeDemandPercentiles(shuffled);
    expect(a).toEqual(b);
  });

  it("reporta el tamaño de muestra usado, para que el caller decida si confiar en el pronóstico", () => {
    const samples: WeeklySample[] = Array.from({ length: 3 }).map(() => ({ orderCount: 5, totalWeightKg: 100 }));
    const result = computeDemandPercentiles(samples);
    expect(result.sampleSize).toBe(3); // por debajo de MIN_SAMPLE_SIZE_FOR_TRUST (4), el caller no debe persistirlo
  });
});
