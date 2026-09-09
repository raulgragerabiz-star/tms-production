import { prisma } from "@/lib/prisma";

// Motor de inteligencia (2/3): predicción de demanda. Documento
// 16-inteligencia-artificial-TMS.md, "Predicción de demanda": "proyección
// de volumen de pedidos por zona/fecha a partir del histórico de order...
// reutiliza el enfoque de percentiles ya presente en tms_getafe.html". Se
// pronostica cada fecha futura comparándola con el histórico del MISMO día
// de la semana (un lunes se parece a otros lunes, no a un sábado) en las
// últimas N semanas.
//
// Adaptado de `_deferred_v1.1_delta/modules/intelligence/demand-forecast.service.ts`
// (nunca integrado): la versión original usaba `$queryRaw` con
// EXTRACT(DOW ...) -- aquí se sustituye por una consulta Prisma normal +
// agregación en memoria (mismo criterio ya aplicado en dashboard.routes.ts y
// anomaly-detection.service.ts), porque no es posible probar SQL a medida
// contra un Postgres real desde este entorno de trabajo y sí lo es revisar
// una consulta Prisma campo a campo contra el schema.

export interface WeeklySample {
  orderCount: number;
  totalWeightKg: number;
}

export interface DemandPercentiles {
  ordersP50: number;
  ordersP80: number;
  weightKgP50: number;
  weightKgP80: number;
  sampleSize: number;
}

/**
 * Función pura -- percentil sobre una muestra ya agregada por semana
 * (documento: "enfoque de percentiles"). P50 = mediana, como estimación
 * central; P80 = umbral de planificación de capacidad ("anticipar
 * necesidad de capacidad de flota antes de que el pool de pendientes se
 * sature" -- se quiere estar preparado para el 80% de los casos, no solo
 * para el caso mediano).
 */
export function computeDemandPercentiles(samples: WeeklySample[]): DemandPercentiles {
  if (samples.length === 0) {
    return { ordersP50: 0, ordersP80: 0, weightKgP50: 0, weightKgP80: 0, sampleSize: 0 };
  }

  const orderCounts = samples.map((s) => s.orderCount).sort((a, b) => a - b);
  const weights = samples.map((s) => s.totalWeightKg).sort((a, b) => a - b);

  return {
    ordersP50: percentile(orderCounts, 0.5),
    ordersP80: percentile(orderCounts, 0.8),
    weightKgP50: percentile(weights, 0.5),
    weightKgP80: percentile(weights, 0.8),
    sampleSize: samples.length,
  };
}

/** Percentil por interpolación lineal sobre un array YA ORDENADO ascendentemente. */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 1) return sortedValues[0];
  const index = p * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

const DAYS_AHEAD = 14; // (config) -- horizonte de pronóstico
const HISTORICAL_WEEKS = 12; // (config) -- nº de semanas hacia atrás usadas como muestra
const MIN_SAMPLE_SIZE_FOR_TRUST = 4; // (config) -- con menos de 4 semanas de histórico, no se pronostica
const RECENT_ORDERS_WINDOW_DAYS = 90; // ventana para descubrir qué combinaciones almacén+provincia siguen activas

function dateOnlyKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Precalcula el pronóstico de los próximos `DAYS_AHEAD` días para TODAS las
 * combinaciones almacén+provincia con histórico reciente, y lo persiste en
 * `demand_forecast`. Se invoca a mano desde el botón "Ejecutar pronóstico
 * ahora" en Backoffice (no hay infraestructura de jobs programados
 * todavía, mismo caso que la detección de anomalías); el Planificador
 * podrá leer el resultado ya guardado sin recalcular nada.
 */
export async function precomputeDemandForecasts(companyId: string): Promise<{ forecastsWritten: number; combosEvaluated: number }> {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // 1. Descubrir combinaciones almacén+provincia con pedidos recientes --
  //    sin esto habría que recorrer TODOS los almacenes contra TODAS las
  //    provincias posibles, la inmensa mayoría sin ningún pedido.
  const recentOrders = await prisma.order.findMany({
    where: {
      companyId,
      requestedDeliveryDate: { gte: addDays(today, -RECENT_ORDERS_WINDOW_DAYS) },
      status: { not: "cancelled" },
    },
    select: { warehouseId: true, deliveryPoint: { select: { province: true } } },
  });

  const combos = new Map<string, { warehouseId: string; province: string }>();
  for (const o of recentOrders) {
    const province = o.deliveryPoint.province;
    if (!province) continue; // sin provincia no se puede segmentar por zona
    combos.set(`${o.warehouseId}::${province}`, { warehouseId: o.warehouseId, province });
  }

  let forecastsWritten = 0;
  const earliestHistoryNeeded = addDays(today, -HISTORICAL_WEEKS * 7 - DAYS_AHEAD); // margen amplio, cubre el lookback de cada targetDate

  for (const combo of combos.values()) {
    // 2. Una única consulta por combinación (no una por día de pronóstico):
    //    trae todo el histórico que pueda hacer falta para los 14 días de
    //    pronóstico de este almacén+provincia, y se agrupa/filtra en JS.
    const historicalOrders = await prisma.order.findMany({
      where: {
        companyId,
        warehouseId: combo.warehouseId,
        deliveryPoint: { province: combo.province },
        requestedDeliveryDate: { gte: earliestHistoryNeeded, lt: today },
        status: { not: "cancelled" },
      },
      select: { requestedDeliveryDate: true, lines: { select: { lineWeightKg: true } } },
    });

    for (let dayOffset = 1; dayOffset <= DAYS_AHEAD; dayOffset++) {
      const targetDate = addDays(today, dayOffset);
      const dayOfWeek = targetDate.getDay(); // 0=domingo .. 6=sábado
      const lookbackStart = addDays(targetDate, -HISTORICAL_WEEKS * 7);

      const byDate = new Map<string, { orderCount: number; weightKg: number }>();
      for (const o of historicalOrders) {
        if (o.requestedDeliveryDate.getDay() !== dayOfWeek) continue;
        if (o.requestedDeliveryDate < lookbackStart || o.requestedDeliveryDate >= targetDate) continue;
        const key = dateOnlyKey(o.requestedDeliveryDate);
        const bucket = byDate.get(key) ?? { orderCount: 0, weightKg: 0 };
        bucket.orderCount += 1;
        bucket.weightKg += o.lines.reduce((acc, l) => acc + Number(l.lineWeightKg ?? 0), 0);
        byDate.set(key, bucket);
      }

      const samples: WeeklySample[] = [...byDate.values()].map((b) => ({ orderCount: b.orderCount, totalWeightKg: b.weightKg }));
      const percentiles = computeDemandPercentiles(samples);
      if (percentiles.sampleSize < MIN_SAMPLE_SIZE_FOR_TRUST) continue; // sin histórico suficiente, no se guarda pronóstico

      await prisma.demandForecast.upsert({
        where: {
          companyId_warehouseId_province_forecastDate: {
            companyId,
            warehouseId: combo.warehouseId,
            province: combo.province,
            forecastDate: targetDate,
          },
        },
        create: {
          companyId,
          warehouseId: combo.warehouseId,
          province: combo.province,
          forecastDate: targetDate,
          expectedOrdersP50: percentiles.ordersP50,
          expectedOrdersP80: percentiles.ordersP80,
          expectedWeightKgP50: percentiles.weightKgP50,
          expectedWeightKgP80: percentiles.weightKgP80,
          sampleSize: percentiles.sampleSize,
        },
        update: {
          expectedOrdersP50: percentiles.ordersP50,
          expectedOrdersP80: percentiles.ordersP80,
          expectedWeightKgP50: percentiles.weightKgP50,
          expectedWeightKgP80: percentiles.weightKgP80,
          sampleSize: percentiles.sampleSize,
          calculatedAt: new Date(),
        },
      });
      forecastsWritten++;
    }
  }

  return { forecastsWritten, combosEvaluated: combos.size };
}
