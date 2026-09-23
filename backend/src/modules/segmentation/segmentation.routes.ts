// Fase 28: pantalla de Backoffice para gestionar `ServiceSegmentationRule`.
//
// Por qué hacía falta: el motor que clasifica un pedido por peso
// (segmentation.service.ts, `classifyServiceSegment`) existe desde antes,
// pero la tabla `service_segmentation_rule` no tenía NINGÚN sitio en
// Backoffice para darla de alta -- sin filas activas, todo pedido caía
// siempre al segmento de reserva (`gran_volumen`), así que la clasificación
// automática por peso no estaba funcionando de verdad en producción.
//
// GET devuelve SIEMPRE los 4 segmentos del enum ServiceType, en un orden fijo
// (de menor a mayor peso): si una empresa aún no tiene la fila de un
// segmento en base de datos, se rellena con una PROPUESTA (marcada
// `persisted: false`) calculada a partir de los umbrales reales que Raúl dio
// para su operativa (Paquetería <=50kg / Paletería <=1200kg / Ligero
// <=3000kg / Pesado >3000kg -- "Ligero"/"Pesado" son las etiquetas visibles
// de "paleteria_pesada"/"gran_volumen", ver RatesPage.tsx) -- nada se
// persiste hasta que se guarda esa fila desde la pantalla.
import { Router } from "express";
import { z } from "zod";
import { ServiceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { invalidateSegmentationRulesCache } from "@/modules/segmentation/segmentation.service";

export const segmentationRouter = Router();

// Orden fijo de menor a mayor peso -- también decide la `priority` con la
// que se guarda cada regla (classifyServiceSegment evalúa por priority
// ascendente y se queda con la primera que cumple todos los límites).
const SEGMENT_ORDER: ServiceType[] = [
  ServiceType.paqueteria,
  ServiceType.paleteria,
  ServiceType.paleteria_pesada,
  ServiceType.gran_volumen,
];

// Propuesta inicial -- umbrales reales de la plantilla de transporte de
// Raúl (Libro1.xlsx, ver claude/fase28-analisis-plantilla-transporte.md):
// "<=50 Paqueteria; <=1200 Paleteria; <=3000 Ligero; >=3001 Pesado". El
// último segmento (Pesado/gran_volumen) se deja sin límite superior -- ya
// funciona como "todo lo que no entre en los tres anteriores" gracias al
// orden por priority, así que maxWeightKg=null es "sin límite", no "cero".
const SUGGESTED_MAX_WEIGHT_KG: Record<ServiceType, number | null> = {
  paqueteria: 50,
  paleteria: 1200,
  paleteria_pesada: 3000,
  gran_volumen: null,
};

interface RuleResponse {
  segment: ServiceType;
  maxWeightKg: number | null;
  maxPallets: number | null;
  maxWeightPerPalletKg: number | null;
  priority: number;
  active: boolean;
  persisted: boolean;
}

function toNumber(v: unknown): number | null {
  return v == null ? null : Number(v);
}

segmentationRouter.get(
  "/rules",
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const existing = await prisma.serviceSegmentationRule.findMany({ where: { companyId } });
    const bySegment = new Map(existing.map((r) => [r.segment, r]));

    const items: RuleResponse[] = SEGMENT_ORDER.map((segment, idx) => {
      const row = bySegment.get(segment);
      if (row) {
        return {
          segment,
          maxWeightKg: toNumber(row.maxWeightKg),
          maxPallets: row.maxPallets,
          maxWeightPerPalletKg: toNumber(row.maxWeightPerPalletKg),
          priority: row.priority,
          active: row.active,
          persisted: true,
        };
      }
      return {
        segment,
        maxWeightKg: SUGGESTED_MAX_WEIGHT_KG[segment],
        maxPallets: null,
        maxWeightPerPalletKg: null,
        priority: idx + 1,
        active: true,
        persisted: false,
      };
    });

    res.json({ items });
  })
);

const upsertSchema = z.object({
  maxWeightKg: z.number().min(0).nullable().optional(),
  maxPallets: z.number().int().min(0).nullable().optional(),
  maxWeightPerPalletKg: z.number().min(0).nullable().optional(),
  active: z.boolean().optional(),
});

// PUT /api/segmentation/rules/:segment -- alta o edición de la regla de UN
// segmento (siempre hay como mucho 4, uno por valor del enum ServiceType,
// @@unique([companyId, segment]) en el esquema -- por eso es upsert y no
// hace falta un POST/DELETE de filas sueltas como en otras pantallas de
// Maestros).
segmentationRouter.put(
  "/rules/:segment",
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const idx = SEGMENT_ORDER.indexOf(req.params.segment as ServiceType);
    if (idx === -1) throw HttpError.badRequest("Segmento no válido");
    const segment = SEGMENT_ORDER[idx];
    const data = upsertSchema.parse(req.body);

    const updated = await prisma.serviceSegmentationRule.upsert({
      where: { companyId_segment: { companyId, segment } },
      create: {
        companyId,
        segment,
        priority: idx + 1,
        maxWeightKg: data.maxWeightKg ?? null,
        maxPallets: data.maxPallets ?? null,
        maxWeightPerPalletKg: data.maxWeightPerPalletKg ?? null,
        active: data.active ?? true,
      },
      update: {
        priority: idx + 1,
        ...(data.maxWeightKg !== undefined ? { maxWeightKg: data.maxWeightKg } : {}),
        ...(data.maxPallets !== undefined ? { maxPallets: data.maxPallets } : {}),
        ...(data.maxWeightPerPalletKg !== undefined ? { maxWeightPerPalletKg: data.maxWeightPerPalletKg } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });

    // Las reglas se cachean 5 minutos (segmentation.service.ts) para no
    // repetir esta consulta por cada pedido de un lote de importación --
    // hay que invalidar tras cualquier cambio para que el siguiente pedido
    // clasificado ya vea la regla nueva.
    invalidateSegmentationRulesCache(companyId);

    const response: RuleResponse = {
      segment: updated.segment,
      maxWeightKg: toNumber(updated.maxWeightKg),
      maxPallets: updated.maxPallets,
      maxWeightPerPalletKg: toNumber(updated.maxWeightPerPalletKg),
      priority: updated.priority,
      active: updated.active,
      persisted: true,
    };
    res.json(response);
  })
);
