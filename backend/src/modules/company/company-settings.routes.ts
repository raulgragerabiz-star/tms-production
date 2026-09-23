// Configuración de empresa -- de momento solo el interruptor de
// auto-asignación del motor de inteligencia (pieza 3/3), pensado para
// crecer con más ajustes de empresa en el futuro sin tener que abrir un
// módulo nuevo cada vez. Restringido al rol Administrador (Fase 23: código
// "admin_empresa", montado con requireRole en app.ts), mismo criterio que
// /api/users.
//
// Fase 8Q2 (retirada en la Fase 24): este módulo tenía también GET/PATCH
// /profile con los datos fiscales/de contacto del emisor de los documentos
// legales (albarán/DeCA). Se ha quitado -- esos datos ahora son por centro,
// no por empresa (ver Maestros > Almacenes y Warehouse.fiscalName/taxId/...
// en schema.prisma, además de document-pdf.service.ts).
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
        // Se convierte autoAssignMinConfidence (Decimal de Prisma) a number
        // -- el campo Json exige un objeto plano (InputJsonValue) y un
        // Decimal no lo es estructuralmente para TypeScript, aunque a
        // tiempo de ejecución serialice bien (mismo tipo de error real ya
        // corregido en auto-optimization.orchestrator.ts).
        newValue: {
          autoAssignSettings: {
            autoAssignEnabled: updated.autoAssignEnabled,
            autoAssignMinConfidence: Number(updated.autoAssignMinConfidence),
          },
        },
      },
    });

    res.json(updated);
  })
);

// Fase 28: umbral de distancia (km) que decide la sugerencia de "Modelo de
// transporte" (a portes / dedicado) de una ruta -- criterio explícito de
// Raúl: "a partir de cierta distancia, el tipo de servicio seria a portes
// por la complegidad de mantener ese tipo de envios dentro de un servicio
// dedicado". `null`/vacío = función desactivada, ninguna ruta se clasifica
// sola todavía (ver recalculateLoadPlan en routes.routes.ts).
companySettingsRouter.get(
  "/transport-model",
  asyncHandler(async (req, res) => {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: req.auth!.companyId },
      select: { transportModelDistanceThresholdKm: true },
    });
    res.json(company);
  })
);

const transportModelSchema = z.object({
  transportModelDistanceThresholdKm: z.number().min(0).nullable(),
});

companySettingsRouter.patch(
  "/transport-model",
  asyncHandler(async (req, res) => {
    const data = transportModelSchema.parse(req.body);
    const updated = await prisma.company.update({
      where: { id: req.auth!.companyId },
      data: { transportModelDistanceThresholdKm: data.transportModelDistanceThresholdKm },
      select: { transportModelDistanceThresholdKm: true },
    });
    res.json(updated);
  })
);
