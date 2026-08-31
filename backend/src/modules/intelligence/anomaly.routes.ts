import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { prisma } from "../../lib/prisma";

const router = Router();

/**
 * GET /api/anomalies?status=pending
 * Alimenta la zona "Atención" del Dashboard (07-dashboard-TMS.md) junto a
 * las incidencias operativas ya existentes — mismo patrón de lista
 * ordenada por antigüedad con acceso directo al detalle.
 */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { status } = req.query as { status?: string };
    const alerts = await prisma.anomalyAlert.findMany({
      where: { companyId: req.auth!.companyId, ...(status ? { status: status as any } : {}) },
      orderBy: { detectedAt: "desc" },
      take: 100,
    });
    return res.status(200).json({ alerts });
  } catch (err) {
    next(err);
  }
});

const ReviewSchema = z.object({ status: z.enum(["reviewed", "dismissed"]) });

/**
 * PATCH /api/anomalies/:id — el planificador/gestor de flota marca la
 * alerta como revisada o la descarta (falso positivo). Nunca corrige
 * datos automáticamente — documento: "generando alerta para revisión
 * humana, no corrección automática".
 */
router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = ReviewSchema.parse(req.body);

    const result = await prisma.anomalyAlert.updateMany({
      where: { id, companyId: req.auth!.companyId },
      data: { status, reviewedBy: req.auth!.userId, reviewedAt: new Date() },
    });

    if (result.count === 0) return res.status(404).json({ error: "alert_not_found" });
    return res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
