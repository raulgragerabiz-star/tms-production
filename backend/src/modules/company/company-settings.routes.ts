// Configuración de empresa -- de momento solo el interruptor de
// auto-asignación del motor de inteligencia (pieza 3/3), pensado para
// crecer con más ajustes de empresa en el futuro sin tener que abrir un
// módulo nuevo cada vez. Restringido a admin_empresa/admin_plataforma
// (montado con requireRole en app.ts), mismo criterio que /api/users.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";

export const companySettingsRouter = Router();

companySettingsRouter.get(
  "/auto-assign",
  asyncHandler(async (req, res) => {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: req.auth!.companyId },
      select: { autoAssignEnabled: true, autoAssignMinConfidence: true },
    });
    res.json(company);
  })
);

const updateSchema = z.object({
  autoAssignEnabled: z.boolean(),
  // Por debajo del 50% no tiene sentido -- peor que lanzar una moneda. El
  // límite superior deja siempre un margen para que un humano intervenga en
  // los casos más dudosos (nunca un candidato se auto-asigna con el 100% de
  // "confianza obligatoria").
  autoAssignMinConfidence: z.number().min(0.5).max(0.99).optional(),
});

companySettingsRouter.patch(
  "/auto-assign",
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const updated = await prisma.company.update({
      where: { id: req.auth!.companyId },
      data: {
        autoAssignEnabled: data.autoAssignEnabled,
        ...(data.autoAssignMinConfidence != null ? { autoAssignMinConfidence: data.autoAssignMinConfidence } : {}),
      },
      select: { autoAssignEnabled: true, autoAssignMinConfidence: true },
    });

    await prisma.auditLog.create({
      data: {
        companyId: req.auth!.companyId,
        userId: req.auth!.sub,
        entityName: "company",
        entityId: req.auth!.companyId,
        action: "update",
        oldValue: {},
        newValue: { autoAssignSettings: updated },
      },
    });

    res.json(updated);
  })
);
