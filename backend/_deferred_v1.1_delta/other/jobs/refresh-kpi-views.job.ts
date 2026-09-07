import { prisma } from "../lib/prisma";

/**
 * Refresca `mv_kpi_shipment_facts`. Usa CONCURRENTLY para que las
 * consultas de KPIs en curso (Dashboard, Informes) sigan sirviéndose de
 * la versión anterior de la vista mientras se recalcula — sin esto, un
 * `REFRESH MATERIALIZED VIEW` normal bloquea la vista completa durante
 * el recálculo, que puede tardar segundos con volumen alto.
 * Requiere el índice único ya creado en la migración SQL
 * (`mv_kpi_shipment_facts_pk`).
 *
 * Frecuencia: cada hora es suficiente para KPIs analíticos (documento
 * 17-kpis-bi-TMS.md: "KPIs analíticos... calculados en agregados
 * periódicos... para no penalizar el rendimiento transaccional"); los
 * KPIs operativos del Dashboard (Fase 6) siguen sirviéndose en
 * near-real-time directamente de las tablas transaccionales vía eventos
 * de Socket.io, sin pasar por esta vista.
 */
export async function refreshKpiMaterializedView(): Promise<{ refreshed: boolean; durationMs: number }> {
  const start = Date.now();
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_kpi_shipment_facts`);
  return { refreshed: true, durationMs: Date.now() - start };
}
