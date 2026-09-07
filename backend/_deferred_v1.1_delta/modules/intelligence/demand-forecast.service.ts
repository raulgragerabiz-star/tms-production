import { prisma } from "../../lib/prisma";

/**
 * Documento 16-inteligencia-artificial-TMS.md, "Predicción de demanda":
 * "proyección de volumen de pedidos por zona/fecha a partir del histórico
 * de order... reutiliza el enfoque de percentiles ya presente en
 * tms_getafe.html". Se pronostica cada fecha futura comparándola con el
 * histórico del MISMO día de la semana (un lunes se parece a otros
 * lunes, no a un sábado) en las últimas N semanas.
 */

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
 * Función pura — percentil sobre una muestra ya agregada por semana
 * (documento: "enfoque de percentiles"). P50 = mediana, como estimación
 * central; P80 = umbral de planificación de capacidad ("anticipar
 * necesidad de capacidad de flota antes de que el pool de pendientes se
 * sature" — se quiere estar preparado para el 80% de los casos, no solo
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

const HISTORICAL_WEEKS = 12; // (config) — nº de semanas hacia atrás usadas como muestra
const MIN_SAMPLE_SIZE_FOR_TRUST = 4; // (config) — con menos de 4 semanas de histórico, no se pronostica

/**
 * Calcula el pronóstico para UNA fecha futura concreta, en un almacén y
 * provincia dados: agrega el histórico de las últimas `HISTORICAL_WEEKS`
 * ocurrencias del mismo día de la semana que `targetDate`.
 */
export async function forecastDemandForDate(
  companyId: string,
  warehouseId: string,
  province: string,
  targetDate: Date
): Promise<DemandPercentiles> {
  const dayOfWeek = targetDate.getDay(); // 0=domingo .. 6=sábado

  const rows = await prisma.$queryRaw<{ order_date: Date; order_count: bigint; total_weight: number }[]>`
    SELECT
      date_trunc('day', o.requested_delivery_date) AS order_date,
      count(DISTINCT o.id) AS order_count,
      coalesce(sum(ol.line_weight_kg), 0) AS total_weight
    FROM "order" o
    JOIN delivery_point dp ON dp.id = o.delivery_point_id
    LEFT JOIN order_line ol ON ol.order_id = o.id
    WHERE o.company_id = ${companyId}
      AND o.warehouse_id = ${warehouseId}
      AND dp.province = ${province}
      AND EXTRACT(DOW FROM o.requested_delivery_date) = ${dayOfWeek}
      AND o.requested_delivery_date >= ${targetDate} - (${HISTORICAL_WEEKS} || ' weeks')::interval
      AND o.requested_delivery_date < ${targetDate}
      AND o.status != 'cancelled'
    GROUP BY date_trunc('day', o.requested_delivery_date)
  `;

  const samples: WeeklySample[] = rows.map((r) => ({
    orderCount: Number(r.order_count),
    totalWeightKg: Number(r.total_weight),
  }));

  return computeDemandPercentiles(samples);
}

/**
 * Precalcula el pronóstico de los próximos `daysAhead` días para TODAS las
 * combinaciones almacén+provincia con histórico reciente, y lo persiste en
 * `demand_forecast`. Se invoca desde el job nocturno — el Planificador
 * nunca dispara este cálculo bajo demanda, siempre lee el resultado ya
 * guardado (mismo criterio de "agregación en BD, no en memoria, ni
 * recalculada en caliente" aplicado ya al resto de módulos de IA/BI).
 */
export async function precomputeDemandForecasts(
  companyId: string,
  daysAhead: number = 14
): Promise<{ forecastsWritten: number }> {
  const combos = await prisma.$queryRaw<{ warehouse_id: string; province: string }[]>`
    SELECT DISTINCT o.warehouse_id, dp.province
    FROM "order" o
    JOIN delivery_point dp ON dp.id = o.delivery_point_id
    WHERE o.company_id = ${companyId}
      AND o.requested_delivery_date >= now() - interval '90 days'
  `;

  let forecastsWritten = 0;

  for (const combo of combos) {
    for (let dayOffset = 1; dayOffset <= daysAhead; dayOffset++) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + dayOffset);
      targetDate.setHours(0, 0, 0, 0);

      const percentiles = await forecastDemandForDate(
        companyId,
        combo.warehouse_id,
        combo.province,
        targetDate
      );

      if (percentiles.sampleSize < MIN_SAMPLE_SIZE_FOR_TRUST) continue; // sin histórico suficiente, no se guarda pronóstico

      await prisma.demandForecast.upsert({
        where: {
          companyId_warehouseId_province_forecastDate: {
            companyId,
            warehouseId: combo.warehouse_id,
            province: combo.province,
            forecastDate: targetDate,
          } as any,
        },
        create: {
          companyId,
          warehouseId: combo.warehouse_id,
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

  return { forecastsWritten };
}
