import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { prisma } from "../../lib/prisma";

const router = Router();

router.get("/auto-assign", requireAuth, async (req, res, next) => {
  try {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: req.auth!.companyId },
      select: { autoAssignEnabled: true, autoAssignMinConfidence: true },
    });
    return res.status(200).json(company);
  } catch (err) {
    next(err);
  }
});

const UpdateSchema = z.object({
  autoAssignEnabled: z.boolean(),
  autoAssignMinConfidence: z.number().min(0.5).max(0.99).optional(), // por debajo de 0.5 no tiene sentido: peor que lanzar una moneda
});

/**
 * PATCH /api/company/settings/auto-assign — pantalla de Configuración
 * (Fase 5, Pantalla 13). Requiere rol `admin_empresa` en tu middleware de
 * permisos real (no incluido aquí — `requireAuth` es el guard genérico ya
 * existente; añade el check de rol específico si tu proyecto ya
 * diferencia permisos por endpoint).
 */
router.patch("/auto-assign", requireAuth, async (req, res, next) => {
  try {
    const data = UpdateSchema.parse(req.body);
    const updated = await prisma.company.update({
      where: { id: req.auth!.companyId },
      data: {
        autoAssignEnabled: data.autoAssignEnabled,
        ...(data.autoAssignMinConfidence != null
          ? { autoAssignMinConfidence: data.autoAssignMinConfidence }
          : {}),
      },
      select: { autoAssignEnabled: true, autoAssignMinConfidence: true },
    });

    await prisma.auditLog.create({
      data: {
        companyId: req.auth!.companyId,
        userId: req.auth!.userId,
        entityName: "company",
        entityId: req.auth!.companyId,
        action: "update",
        oldValue: {},
        newValue: { autoAssignSettings: updated },
      },
    });

    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
