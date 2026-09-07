import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import { prisma } from "../../lib/prisma";

const router = Router();

/**
 * GET /api/demand-forecast?warehouseId=...&from=...&to=...
 * Documento: "anticipar necesidad de capacidad de flota antes de que el
 * pool de pendientes se sature". El Planificador (Fase 7) consulta esto
 * para los próximos días y puede reforzar transportistas/vehículos con
 * antelación en las provincias donde el P80 indique un pico previsible.
 */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { warehouseId, from, to } = req.query as { warehouseId?: string; from?: string; to?: string };
    const companyId = req.auth!.companyId;

    const forecasts = await prisma.demandForecast.findMany({
      where: {
        companyId,
        ...(warehouseId ? { warehouseId } : {}),
        forecastDate: {
          gte: from ? new Date(from) : new Date(),
          lte: to ? new Date(to) : addDays(new Date(), 14),
        },
      },
      orderBy: [{ forecastDate: "asc" }, { expectedOrdersP80: "desc" }],
    });

    return res.status(200).json({ forecasts });
  } catch (err) {
    next(err);
  }
});

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export default router;
