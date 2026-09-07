import { Router } from "express";
import { z } from "zod";
import { requireCarrierPortal } from "../../middleware/requireCarrierPortal"; // ya existente
import { requireAuth } from "../../middleware/requireAuth";
import { prisma } from "../../lib/prisma";

const router = Router();

const DisputeSchema = z.object({ comment: z.string().min(5).max(1000) });

/**
 * PATCH /api/carrier-portal/settlement-lines/:lineId/dispute
 * Documento 13-portal-transportista-TMS.md: "posibilidad de marcar una
 * línea como disputed con comentario, iniciando el ciclo de revisión".
 * Scope reforzado a nivel de backend: la línea debe pertenecer a una
 * `carrier_settlement` de ESTE transportista, nunca solo por lineId.
 */
router.patch("/settlement-lines/:lineId/dispute", requireCarrierPortal, async (req, res, next) => {
  try {
    const { lineId } = req.params;
    const { comment } = DisputeSchema.parse(req.body);
    const carrierId = req.auth!.carrierId!;

    const line = await prisma.settlementLine.findFirst({
      where: { id: lineId, carrierSettlement: { carrierId } },
      include: { carrierSettlement: true },
    });

    if (!line) {
      return res.status(404).json({ error: "settlement_line_not_found_for_carrier" });
    }

    if (line.status === "disputed") {
      return res.status(409).json({ error: "already_disputed" });
    }

    const updated = await prisma.settlementLine.update({
      where: { id: lineId },
      data: {
        status: "disputed",
        disputeComment: comment,
        disputedAt: new Date(),
        disputedBy: req.auth!.userId,
      },
    });

    // La cabecera (carrier_settlement) pasa a `disputed` si no lo estaba ya
    // — mismo ciclo ya definido en 03-arquitectura-TMS.md §5.4
    // (Generada → Validada → Aprobada → Pagada ↘ Disputada → vuelve a Validada).
    if (line.carrierSettlement.status !== "disputed") {
      await prisma.carrierSettlement.update({
        where: { id: line.carrierSettlementId },
        data: { status: "disputed" },
      });
    }

    return res.status(200).json({ settlementLine: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/settlement-lines/:lineId/resolve-dispute
 * Contraparte interna (administración/gestor de flota): resuelve la
 * disputa, ajustando el importe si procede, y la línea vuelve a `accepted`.
 * No forma parte del Portal Transportista — es backoffice.
 */
const ResolveDisputeSchema = z.object({
  resolution: z.enum(["accept_original", "adjust_amount"]),
  newAmount: z.number().positive().optional(),
  resolutionComment: z.string().min(5).max(1000),
});

router.patch("/internal/settlement-lines/:lineId/resolve-dispute", requireAuth, async (req, res, next) => {
  try {
    const { lineId } = req.params;
    const { resolution, newAmount, resolutionComment } = ResolveDisputeSchema.parse(req.body);

    const line = await prisma.settlementLine.findUniqueOrThrow({ where: { id: lineId } });
    if (line.status !== "disputed") {
      return res.status(409).json({ error: "line_not_in_disputed_state" });
    }
    if (resolution === "adjust_amount" && !newAmount) {
      return res.status(400).json({ error: "new_amount_required_for_adjust_amount" });
    }

    const updated = await prisma.settlementLine.update({
      where: { id: lineId },
      data: {
        status: "accepted",
        amount: resolution === "adjust_amount" ? newAmount : line.amount,
        breakdown: {
          ...(line.breakdown as any),
          disputeResolution: { resolution, resolutionComment, resolvedAt: new Date().toISOString() },
        },
      },
    });

    return res.status(200).json({ settlementLine: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
