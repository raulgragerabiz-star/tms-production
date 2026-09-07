import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { queryKpis, getKpiCatalog, DIMENSIONS, METRICS } from "./kpi.service";

const router = Router();

const dimensionKeys = Object.keys(DIMENSIONS) as [string, ...string[]];
const metricKeys = Object.keys(METRICS) as [string, ...string[]];

const KpiQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  dimensions: z.array(z.enum(dimensionKeys)).default([]),
  metrics: z.array(z.enum(metricKeys)).min(1),
  period: z.enum(["day", "week", "month"]).optional(),
  filters: z.record(z.string()).optional(),
});

/**
 * GET /api/kpis/catalog — alimenta el selector dinámico del frontend
 * (Fase 5, Pantalla 12) sin hardcodear la lista de KPIs disponibles en dos
 * sitios distintos.
 */
router.get("/catalog", requireAuth, (_req, res) => {
  res.status(200).json(getKpiCatalog());
});

/**
 * POST /api/kpis/query — body en vez de query string porque `dimensions`/
 * `metrics`/`filters` son estructuras, no valores simples; evita el
 * problema de serializar arrays y objetos en una querystring GET.
 */
router.post("/query", requireAuth, async (req, res, next) => {
  try {
    const parsed = KpiQuerySchema.parse(req.body);
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

    return res.status(200).json({ rows });
  } catch (err) {
    next(err);
  }
});

export default router;
