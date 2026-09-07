import cronParser from "cron-parser";
import { prisma } from "../lib/prisma";
import { queryKpis, DimensionKey, MetricKey, PeriodGranularity } from "../modules/kpi/kpi.service";
import { exportToCsv, exportToXlsx, exportToPdf } from "../modules/kpi/kpi-export.service";
import { sendReportEmail } from "../lib/mailer";

/**
 * Se ejecuta cada 15 minutos (ver scheduler.ts) y comprueba, para cada
 * `scheduled_report` activo, si su `cronExpression` tiene una ejecución
 * pendiente desde la última vez que se envió. Un solo dispatcher genérico
 * en vez de un cron individual por informe — con potencialmente decenas
 * de informes configurados, registrar un `cron.schedule()` por cada uno
 * dejaría igual número de temporizadores activos en el proceso Node sin
 * necesidad; este patrón escala sin coste adicional por informe.
 */
export async function dispatchScheduledReports(): Promise<{
  checked: number;
  sentCount: number;
  errors: { reportId: string; message: string }[];
}> {
  const reports = await prisma.scheduledReport.findMany({ where: { active: true } });
  const now = new Date();
  let sentCount = 0;
  const errors: { reportId: string; message: string }[] = [];

  for (const report of reports) {
    try {
      const isDue = isReportDue(report.cronExpression, report.lastSentAt, now);
      if (!isDue) continue;

      await sendOneReport(report);
      await prisma.scheduledReport.update({
        where: { id: report.id },
        data: { lastSentAt: now },
      });
      sentCount++;
    } catch (err: any) {
      errors.push({ reportId: report.id, message: err?.message ?? "error desconocido" });
      console.error(`[scheduled-reports] Fallo al procesar "${report.name}" (${report.id})`, err);
    }
  }

  return { checked: reports.length, sentCount, errors };
}

/**
 * Un informe está "vencido" si la última ejecución teórica de su cron
 * (calculada hacia atrás desde `now`) es posterior al último envío
 * registrado. Se usa un margen de 16 min (una ventana del dispatcher +
 * 1 min de colchón) para no perder disparos por pequeños desfases de
 * temporización del propio cron del dispatcher.
 */
function isReportDue(cronExpression: string, lastSentAt: Date | null, now: Date): boolean {
  try {
    const interval = cronParser.parseExpression(cronExpression, { currentDate: now });
    const prevFireTime = interval.prev().toDate();

    const withinDispatchWindow = now.getTime() - prevFireTime.getTime() <= 16 * 60 * 1000;
    const notSentYetForThisFire = !lastSentAt || lastSentAt < prevFireTime;

    return withinDispatchWindow && notSentYetForThisFire;
  } catch {
    return false; // cronExpression inválida — se ignora, no se tira el resto del dispatcher
  }
}

async function sendOneReport(report: {
  id: string;
  companyId: string;
  name: string;
  metrics: string[];
  dimensions: string[];
  period: string | null;
  filters: unknown;
  format: string;
  recipientEmails: string[];
}) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30); // ventana por defecto: últimos 30 días — (config) ampliable a futuro

  const rows = await queryKpis({
    companyId: report.companyId,
    from,
    to,
    dimensions: report.dimensions as DimensionKey[],
    metrics: report.metrics as MetricKey[],
    period: (report.period as PeriodGranularity) ?? undefined,
    filters: (report.filters as any) ?? undefined,
  });

  const filenameBase = report.name.replace(/[^\w\-]+/g, "_").toLowerCase();
  let attachment: { filename: string; content: Buffer | string; contentType: string };

  if (report.format === "csv") {
    attachment = {
      filename: `${filenameBase}.csv`,
      content: exportToCsv(rows),
      contentType: "text/csv",
    };
  } else if (report.format === "xlsx") {
    attachment = {
      filename: `${filenameBase}.xlsx`,
      content: await exportToXlsx(rows, report.name),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  } else {
    attachment = {
      filename: `${filenameBase}.pdf`,
      content: await exportToPdf(rows, report.name),
      contentType: "application/pdf",
    };
  }

  await sendReportEmail({
    to: report.recipientEmails,
    subject: `Informe programado: ${report.name}`,
    bodyText: `Adjunto el informe "${report.name}" correspondiente al periodo ${from.toLocaleDateString("es-ES")} - ${to.toLocaleDateString("es-ES")}. Generado automáticamente por el TMS.`,
    attachment,
  });
}
