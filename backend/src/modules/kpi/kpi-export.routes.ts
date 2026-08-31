import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { queryKpis, DIMENSIONS, METRICS } from "./kpi.service";
import { exportToCsv, exportToXlsx, exportToPdf } from "./kpi-export.service";

const router = Router();

const dimensionKeys = Object.keys(DIMENSIONS) as [string, ...string[]];
const metricKeys = Object.keys(METRICS) as [string, ...string[]];

const ExportSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  dimensions: z.array(z.enum(dimensionKeys)).default([]),
  metrics: z.array(z.enum(metricKeys)).min(1),
  period: z.enum(["day", "week", "month"]).optional(),
  filters: z.record(z.string()).optional(),
  format: z.enum(["csv", "xlsx", "pdf"]),
  title: z.string().max(120).default("Informe TMS"),
});

/**
 * POST /api/kpis/export — mismo query builder que /kpis/query (Fase 5,
 * Pantalla 12: "Todo es exportable a Excel/CSV desde cualquier tabla, con
 * un único botón consistente"); aquí se añade PDF como tercer formato.
 */
router.post("/export", requireAuth, async (req, res, next) => {
  try {
    const parsed = ExportSchema.parse(req.body);
    const companyId = req.auth!.companyId;

    const rows = await queryKpis({
      companyId,
      from: new Date(parsed.from),
      to: new Date(parsed.to),
      dimensions: parsed.dimensions as any,
      metrics: parsed.metrics as any,
      period: parsed.period,
      filters: parsed.filters as any,
    });

    const filenameBase = parsed.title.replace(/[^\w\-]+/g, "_").toLowerCase();

    if (parsed.format === "csv") {
      const csv = exportToCsv(rows);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
      return res.status(200).send(csv);
    }

    if (parsed.format === "xlsx") {
      const buffer = await exportToXlsx(rows, parsed.title);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
      return res.status(200).send(buffer);
    }

    // pdf
    const buffer = await exportToPdf(rows, parsed.title);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.pdf"`);
    return res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
});

export default router;
