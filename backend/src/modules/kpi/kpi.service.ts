import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

/**
 * Documento 17-kpis-bi-TMS.md, "Enfoque": los 150+ KPIs se definen como
 * combinaciones sistemáticas de dimensiones × métricas base, todas sobre
 * las mismas entidades ya modeladas — "evita 150 fórmulas distintas de
 * mantenimiento". Esta whitelist es literalmente esa tabla de
 * combinaciones posibles, ya materializada en `mv_kpi_shipment_facts`
 * (ver migrations_manual/v1_1_kpi_materialized_view.sql).
 *
 * SEGURIDAD: tanto DIMENSIONS como METRICS son whitelists cerradas — el
 * nombre de columna real solo se interpola en el SQL después de validar
 * que la clave pedida por el cliente existe en estos mapas. Nunca se
 * concatena directamente lo que llega en la query string.
 */

export const DIMENSIONS = {
  warehouseId: "warehouse_id",
  carrierId: "carrier_id",
  vehicleTypeId: "vehicle_type_id",
  driverId: "driver_id",
  customerId: "customer_id",
  serviceType: "service_type",
  province: "province",
} as const;

export type DimensionKey = keyof typeof DIMENSIONS;

// Granularidad de periodo — se resuelve con date_trunc, no como columna
// directa de la dimensión "period" (documento: "periodo (día/semana/mes)").
const PERIOD_TRUNC = { day: "day", week: "week", month: "month" } as const;
export type PeriodGranularity = keyof typeof PERIOD_TRUNC;

export const METRICS = {
  // Costes
  costEstimatedAvg: { sql: "AVG(cost_estimated)", label: "Coste estimado medio" },
  costRealAvg: { sql: "AVG(cost_real)", label: "Coste real medio" },
  costDeviationPct: {
    sql: "AVG(CASE WHEN cost_estimated > 0 THEN ((cost_real - cost_estimated) / cost_estimated) * 100 ELSE NULL END)",
    label: "Desviación coste estimado vs. real (%)",
  },
  costRealSum: { sql: "SUM(cost_real)", label: "Coste real total" },

  // Ocupación / volumen
  weightKgSum: { sql: "SUM(weight_kg)", label: "Peso total (kg)" },
  palletsSum: { sql: "SUM(pallets)", label: "Palés totales" },
  costPerKg: { sql: "SUM(cost_real) / NULLIF(SUM(weight_kg), 0)", label: "Coste medio por kg" },
  costPerPallet: { sql: "SUM(cost_real) / NULLIF(SUM(pallets), 0)", label: "Coste medio por palé" },

  // Servicio
  otifPct: { sql: "AVG(otif_flag) * 100", label: "OTIF (%)" },
  stopsCount: { sql: "COUNT(*)", label: "Número de paradas" },

  // Incidencias
  incidentCountSum: { sql: "SUM(incident_count)", label: "Nº incidencias" },
  incidentRatePct: {
    sql: "(SUM(incident_count)::numeric / NULLIF(COUNT(*), 0)) * 100",
    label: "Tasa de incidencias (%)",
  },
  avgIncidentResolutionMinutes: {
    sql: "AVG(avg_incident_resolution_minutes)",
    label: "Tiempo medio de resolución de incidencias (min)",
  },

  // Rutas / distancia
  distancePlannedAvg: { sql: "AVG(distance_planned_km)", label: "Distancia planificada media (km)" },
  distanceRealAvg: { sql: "AVG(distance_real_km)", label: "Distancia real media (km)" },
  distanceDeviationPct: {
    sql: "AVG(CASE WHEN distance_planned_km > 0 THEN ((distance_real_km - distance_planned_km) / distance_planned_km) * 100 ELSE NULL END)",
    label: "Desviación distancia planificada vs. real (%)",
  },
} as const;

export type MetricKey = keyof typeof METRICS;

export interface KpiQueryParams {
  companyId: string;
  from: Date;
  to: Date;
  dimensions: DimensionKey[]; // 0..N — sin dimensiones = un único total agregado
  metrics: MetricKey[]; // 1..N
  period?: PeriodGranularity; // si se pide, añade "period" como dimensión temporal
  filters?: Partial<Record<DimensionKey, string>>; // filtro exacto opcional por dimensión
}

export interface KpiRow {
  [key: string]: string | number | null;
}

/**
 * Punto de entrada único para CUALQUIER combinación de KPI del documento
 * 17-kpis-bi-TMS.md. No hay una función por indicador — la combinación
 * (dimensiones × métricas) que pida el caller determina el KPI resultante,
 * generado dinámicamente contra la vista materializada.
 */
export async function queryKpis(params: KpiQueryParams): Promise<KpiRow[]> {
  if (params.metrics.length === 0) {
    throw new Error("Se requiere al menos una métrica");
  }
  for (const m of params.metrics) {
    if (!(m in METRICS)) throw new Error(`Métrica no reconocida: ${m}`);
  }
  for (const d of params.dimensions) {
    if (!(d in DIMENSIONS)) throw new Error(`Dimensión no reconocida: ${d}`);
  }
  if (params.period && !(params.period in PERIOD_TRUNC)) {
    throw new Error(`Granularidad de periodo no reconocida: ${params.period}`);
  }

  const selectDimensions = params.dimensions.map(
    (d) => Prisma.raw(`${DIMENSIONS[d]} AS "${d}"`)
  );
  const periodSelect = params.period
    ? [Prisma.raw(`date_trunc('${PERIOD_TRUNC[params.period]}', stop_date) AS "period"`)]
    : [];

  const selectMetrics = params.metrics.map(
    (m) => Prisma.raw(`${METRICS[m].sql} AS "${m}"`)
  );

  const selectClause = Prisma.join([...periodSelect, ...selectDimensions, ...selectMetrics], ", ");

  const groupByColumns = [
    ...(params.period ? ["period"] : []),
    ...params.dimensions.map((d) => `"${d}"`),
  ];

  // WHERE: company_id + rango de fechas son obligatorios (parametrizados,
  // valores reales, no interpolación de identificador). Los filtros
  // opcionales por dimensión también van parametrizados.
  let whereClause = Prisma.sql`WHERE company_id = ${params.companyId} AND stop_date BETWEEN ${params.from} AND ${params.to}`;

  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      if (!value) continue;
      if (!(key in DIMENSIONS)) continue; // ya validado arriba, doble check defensivo
      const column = DIMENSIONS[key as DimensionKey];
      whereClause = Prisma.sql`${whereClause} AND ${Prisma.raw(column)} = ${value}`;
    }
  }

  const groupByClause =
    groupByColumns.length > 0 ? Prisma.raw(`GROUP BY ${groupByColumns.join(", ")}`) : Prisma.empty;
  const orderByClause =
    groupByColumns.length > 0 ? Prisma.raw(`ORDER BY ${groupByColumns.join(", ")}`) : Prisma.empty;

  const query = Prisma.sql`
    SELECT ${selectClause}
    FROM mv_kpi_shipment_facts
    ${whereClause}
    ${groupByClause}
    ${orderByClause}
    LIMIT 5000
  `;

  return prisma.$queryRaw<KpiRow[]>(query);
}

/** Catálogo expuesto al frontend para construir el selector de KPI dinámicamente. */
export function getKpiCatalog() {
  return {
    dimensions: Object.keys(DIMENSIONS).map((key) => ({ key })),
    metrics: Object.entries(METRICS).map(([key, def]) => ({ key, label: def.label })),
    periods: Object.keys(PERIOD_TRUNC),
  };
}
