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

// Fase 8Q2: datos fiscales/de contacto del emisor -- petición de Raúl,
// "documentación real asociada a los pedidos" (albarán de entrega y carta de
// porte). Se imprimen en la cabecera/pie de esos documentos (ver
// document-pdf.service.ts); sin rellenar, esa línea simplemente no aparece.
companySettingsRouter.get(
  "/profile",
  asyncHandler(async (req, res) => {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: req.auth!.companyId },
      select: {
        name: true,
        taxId: true,
        address: true,
        postalCode: true,
        city: true,
        province: true,
        phone: true,
        email: true,
        mercantileRegistryText: true,
      },
    });
    res.json(company);
  })
);

const profileSchema = z.object({
  address: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  mercantileRegistryText: z.string().optional(),
});

companySettingsRouter.patch(
  "/profile",
  asyncHandler(async (req, res) => {
    const data = profileSchema.parse(req.body);
    const updated = await prisma.company.update({
      where: { id: req.auth!.companyId },
      data,
      select: {
        name: true,
        taxId: true,
        address: true,
        postalCode: true,
        city: true,
        province: true,
        phone: true,
        email: true,
        mercantileRegistryText: true,
      },
    });
    res.json(updated);
  })
);

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
