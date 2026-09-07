import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { cleanupRevokedVehicleQrTokens } from "./cleanup-vehicle-qr-tokens.job";
import { refreshKpiMaterializedView } from "./refresh-kpi-views.job";
import { dispatchScheduledReports } from "./dispatch-scheduled-reports.job";
import { calibrateRouteSpeeds } from "./calibrate-route-speeds.job";
import { runNightlyAnomalyDetection } from "./run-anomaly-detection.job";
import { runDemandForecastPrecomputation } from "./precompute-demand-forecast.job";

/**
 * Registro central de jobs programados del backend. Patrón elegido:
 * `node-cron` in-process (sin infraestructura adicional tipo Redis/BullMQ),
 * coherente con el volumen actual del proyecto (Fase 17, MVP) y con la
 * restricción ya conocida de Raul (sin Docker Desktop / instalación admin
 * en el portátil corporativo — node-cron no requiere ningún servicio
 * externo, corre dentro del mismo proceso Node del backend).
 *
 * Si el volumen de jobs crece (Versión 2/3 del roadmap), esto es
 * sustituible por una cola real sin tocar la firma de cada job individual
 * — cada función de job ya es independiente y sin estado.
 */

interface ScheduledJobDefinition {
  name: string;
  cronExpression: string; // sintaxis estándar cron (min hora día mes díaSemana)
  run: () => Promise<{ [key: string]: unknown }>;
}

const jobs: ScheduledJobDefinition[] = [
  {
    name: "cleanup_revoked_vehicle_qr_tokens",
    cronExpression: process.env.QR_TOKEN_CLEANUP_CRON ?? "0 3 * * *", // (config) 03:00 cada día
    run: cleanupRevokedVehicleQrTokens,
  },
  {
    name: "refresh_kpi_materialized_view",
    cronExpression: process.env.KPI_REFRESH_CRON ?? "0 * * * *", // (config) cada hora en punto
    run: refreshKpiMaterializedView,
  },
  {
    name: "dispatch_scheduled_reports",
    cronExpression: process.env.SCHEDULED_REPORTS_DISPATCH_CRON ?? "*/15 * * * *", // (config) cada 15 min
    run: dispatchScheduledReports,
  },
  {
    name: "calibrate_route_speeds",
    cronExpression: process.env.ROUTE_SPEED_CALIBRATION_CRON ?? "30 2 * * *", // (config) 02:30 cada día, antes del refresco de KPIs
    run: calibrateRouteSpeeds,
  },
  {
    name: "run_nightly_anomaly_detection",
    cronExpression: process.env.ANOMALY_DETECTION_CRON ?? "0 4 * * *", // (config) 04:00 cada día
    run: runNightlyAnomalyDetection,
  },
  {
    name: "precompute_demand_forecast",
    cronExpression: process.env.DEMAND_FORECAST_CRON ?? "0 5 * * *", // (config) 05:00 cada día
    run: runDemandForecastPrecomputation,
  },
];

export function startScheduledJobs() {
  if (process.env.DISABLE_SCHEDULED_JOBS === "true") {
    console.log("[jobs] Scheduled jobs disabled via DISABLE_SCHEDULED_JOBS");
    return;
  }

  for (const job of jobs) {
    cron.schedule(job.cronExpression, () => runJobSafely(job));
    console.log(`[jobs] Registered "${job.name}" with schedule "${job.cronExpression}"`);
  }
}

async function runJobSafely(job: ScheduledJobDefinition) {
  const startedAt = new Date();
  try {
    const result = await job.run();
    console.log(`[jobs] "${job.name}" completed`, result);

    // OPTIMIZACIÓN: no escribir audit_log si el job no tuvo efecto real
    // (ej. deletedCount === 0). El cron corre a diario; si la mayoría de
    // los días no hay nada que limpiar, registrar igualmente una fila de
    // auditoría vacía cada vez es puro ruido — se sigue viendo en los
    // logs de consola (ya suficiente para operativa normal), y se
    // reserva audit_log para cuando el job realmente cambió algo.
    const hasEffect = Object.entries(result).some(
      ([key, value]) => key.toLowerCase().includes("count") && typeof value === "number" && value > 0
    );

    if (hasEffect) {
      await prisma.auditLog.create({
        data: {
          companyId: null as any, // job transversal, no ligado a una company concreta
          userId: null as any, // ejecución del sistema, no de un usuario
          entityName: "scheduled_job",
          entityId: job.name,
          action: "update",
          oldValue: {},
          newValue: { ...result, startedAt, finishedAt: new Date() },
        },
      }).catch((err) => {
        // El fallo de auditoría no debe tirar el job en sí, solo se loguea.
        console.error(`[jobs] Failed to write audit_log for "${job.name}"`, err);
      });
    }
  } catch (err) {
    console.error(`[jobs] "${job.name}" failed`, err);
  }
}

// Exportado para poder invocar jobs manualmente desde un script/CLI o
// desde un test, sin esperar al cron (ver src/tests/jobs/).
export { jobs as scheduledJobDefinitions };
