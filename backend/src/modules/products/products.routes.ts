import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { requireRole } from "@/middleware/auth";
import {
  buildProductMasterTemplate,
  startProductMasterImportJob,
  wipeProductCatalog,
} from "./product-master-import.service";
import { getProductImportJob } from "./lib/product-import-jobs.store";

export const productsRouter = Router();

// Fase 8R: rediseño del catálogo de productos sobre el formato de columnas
// REAL de Bigmat (ver product-master-parser.ts). salesUnit/unitsPerPallet/
// grossWeightKg/fullPalletWeightKg dejaron de ser obligatorios -- la
// plantilla real no siempre trae peso ni unidad de venta, y esos campos
// quedan "pendientes de rellenar" en vez de bloquear la creación del
// producto (petición explícita de Raúl). El alta/edición manual desde
// Maestros > Productos sigue pudiendo rellenarlos en cualquier momento.
const productSchema = z.object({
  sku: z.string().min(1),
  description: z.string().min(1),
  internalCode: z.string().optional(),
  supplier: z.string().optional(),
  salesUnit: z.string().optional(),
  measurementUnit: z.string().optional(),
  unitsPerBox: z.number().int().positive().optional(),
  unitsPerPallet: z.number().int().positive().optional(),
  grossWeightKg: z.number().positive().optional(),
  netWeightKg: z.number().positive().optional(),
  fullPalletWeightKg: z.number().positive().optional(),
  weightUnit: z.string().optional(),
  requiresCold: z.boolean().optional(),
  // Fase 8Q: mercancía ADR -- ver comentario en Product.requiresAdr en
  // schema.prisma. Se usa ahora como restricción real en el motor de
  // compatibilidad (optimization.routes.ts) y en la puntuación de
  // auto-asignación (auto-optimization.orchestrator.ts).
  requiresAdr: z.boolean().optional(),
  isReturnable: z.boolean().optional(),
  carriageNoteDescription: z.string().optional(),
  // Medidas por nivel de empaquetado (cm, "Fondo x Ancho x Alto" tal cual la
  // plantilla real) -- ver derivePalletMetersFromCm más abajo para cómo se
  // mantiene sincronizado lengthM/widthM/heightM (metros, los que de verdad
  // consume el motor de rutas).
  unitDepthCm: z.number().positive().optional(),
  unitWidthCm: z.number().positive().optional(),
  unitHeightCm: z.number().positive().optional(),
  boxDepthCm: z.number().positive().optional(),
  boxWidthCm: z.number().positive().optional(),
  boxHeightCm: z.number().positive().optional(),
  palletDepthCm: z.number().positive().optional(),
  palletWidthCm: z.number().positive().optional(),
  palletHeightCm: z.number().positive().optional(),
  // Objetivo 2: dimensiones del palé completo en metros -- se pueden seguir
  // editando directamente (compatibilidad con lo ya cargado antes de este
  // rediseño), aunque lo habitual ahora es rellenar palletDepthCm/... y
  // dejar que se deriven solas.
  lengthM: z.number().positive().optional(),
  widthM: z.number().positive().optional(),
  heightM: z.number().positive().optional(),
  stackable: z.boolean().optional(),
  stackableLayers: z.number().int().nonnegative().optional(),
  storageConditions: z.string().optional(),
  packagingType: z.string().optional(),
  minOrderQtyB2c: z.number().int().nonnegative().optional(),
  // Referencias del catálogo real: categoría/familia, clasificación ABC de
  // rotación y código EAN -- informativos, no afectan a ningún cálculo.
  category: z.string().optional(),
  abcClass: z.string().optional(),
  ean: z.string().optional(),
});

// Si llegan las 3 medidas de Palet (cm), se derivan lengthM/widthM/heightM
// (metros) para que recalculateLoadPlan (routes.routes.ts) siga funcionando
// sin tocarlo -- ver mismo cálculo en product-master-import.service.ts.
function derivePalletMetersFromCm(data: {
  palletDepthCm?: number;
  palletWidthCm?: number;
  palletHeightCm?: number;
}): { lengthM?: number; widthM?: number; heightM?: number } {
  if (data.palletDepthCm == null || data.palletWidthCm == null || data.palletHeightCm == null) return {};
  return {
    lengthM: data.palletDepthCm / 100,
    widthM: data.palletWidthCm / 100,
    heightM: data.palletHeightCm / 100,
  };
}

// Montadas ANTES de "/:id" -- si no, Express interpretaría "import" y
// "wipe-catalog" como un :id literal y nunca llegarían aquí (mismo motivo ya
// documentado en orders.routes.ts y customers.routes.ts).
productsRouter.get(
  "/import/template",
  asyncHandler(async (_req, res) => {
    const buffer = buildProductMasterTemplate();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="plantilla-catalogo-productos.xlsx"');
    res.send(buffer);
  })
);

const importProductsSchema = z.object({
  fileBase64: z.string().min(1),
  fileName: z.string().optional(),
});

// Responde de inmediato con un identificador de trabajo -- el procesamiento
// real ocurre en segundo plano (el catálogo real de Bigmat tiene miles de
// filas, ver product-master-import.service.ts).
productsRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const { fileBase64 } = importProductsSchema.parse(req.body);
    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileBase64, "base64");
    } catch {
      throw HttpError.badRequest("El archivo no es un base64 válido");
    }
    if (buffer.length === 0) throw HttpError.badRequest("El archivo está vacío");

    const { importId, totalProducts } = startProductMasterImportJob(req.auth!.companyId, buffer);
    res.json({ importId, totalProducts });
  })
);

productsRouter.get(
  "/import/:importId/status",
  asyncHandler(async (req, res) => {
    const job = getProductImportJob(req.params.importId);
    if (!job) throw HttpError.notFound("No se encuentra esa importación (puede que el servidor se haya reiniciado)");
    res.json({
      status: job.status,
      totalProducts: job.totalProducts,
      processedProducts: job.processedProducts,
      summary: job.status === "done" ? job.summary : undefined,
      error: job.status === "error" ? job.error : undefined,
    });
  })
);

// "Vaciar el catálogo actual" -- restringido a administradores por ser una
// acción masiva sobre datos reales (ver wipeProductCatalog para el porqué de
// que no sea un borrado físico incondicional).
productsRouter.post(
  "/wipe-catalog",
  requireRole("admin_empresa", "admin_plataforma"),
  asyncHandler(async (req, res) => {
    const summary = await wipeProductCatalog(req.auth!.companyId);
    res.json(summary);
  })
);

productsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const search = (req.query.search as string) ?? "";
    const page = parseInt((req.query.page as string) ?? "1", 10);
    const pageSize = Math.min(parseInt((req.query.pageSize as string) ?? "25", 10), 100);

    const where = {
      companyId: req.auth!.companyId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: "insensitive" as const } },
              { description: { contains: search, mode: "insensitive" as const } },
              { internalCode: { contains: search, mode: "insensitive" as const } },
              { ean: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.product.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { sku: "asc" } }),
      prisma.product.count({ where }),
    ]);

    res.json({ items, total, page, pageSize });
  })
);

productsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!product) throw HttpError.notFound("Producto no encontrado");
    res.json(product);
  })
);

productsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = productSchema.parse(req.body);
    // Fase 8Q: `as any` -- varios de estos campos todavía no están en el
    // Prisma Client de este sandbox (sin red para regenerarlo); en el
    // entorno real, tras `npx prisma generate`, quedan tipados sin
    // necesidad del cast.
    const product = await prisma.product.create({
      data: { ...data, ...derivePalletMetersFromCm(data), companyId: req.auth!.companyId } as any,
    });
    res.status(201).json(product);
  })
);

productsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = productSchema.partial().parse(req.body);
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!product) throw HttpError.notFound("Producto no encontrado");
    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { ...data, ...derivePalletMetersFromCm(data) } as any,
    });
    res.json(updated);
  })
);
