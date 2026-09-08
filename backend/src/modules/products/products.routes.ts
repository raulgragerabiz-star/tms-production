import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";

export const productsRouter = Router();

const productSchema = z.object({
  sku: z.string().min(1),
  description: z.string().min(1),
  salesUnit: z.string().min(1),
  unitsPerPallet: z.number().int().positive(),
  grossWeightKg: z.number().positive(),
  netWeightKg: z.number().positive().optional(),
  fullPalletWeightKg: z.number().positive(),
  requiresCold: z.boolean().optional(),
  isReturnable: z.boolean().optional(),
  carriageNoteDescription: z.string().optional(),
  // Objetivo 2: dimensiones del palé completo, para calcular volumen real
  // ocupado por ruta (ver routing.service.ts / recalculateLoadPlan).
  lengthM: z.number().positive().optional(),
  widthM: z.number().positive().optional(),
  heightM: z.number().positive().optional(),
});

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
    const product = await prisma.product.create({ data: { ...data, companyId: req.auth!.companyId } });
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
    const updated = await prisma.product.update({ where: { id: product.id }, data });
    res.json(updated);
  })
);
