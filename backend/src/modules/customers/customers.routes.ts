import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";

export const customersRouter = Router();

const customerSchema = z.object({
  businessCode: z.string().min(1).max(10),
  legalName: z.string().min(1),
  commercialName: z.string().optional(),
  taxId: z.string().optional(),
  active: z.boolean().optional(),
});

// GET /api/customers?search=&page=&pageSize=
customersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const search = (req.query.search as string) ?? "";
    const page = parseInt((req.query.page as string) ?? "1", 10);
    const pageSize = Math.min(parseInt((req.query.pageSize as string) ?? "25", 10), 100);

    const where = {
      companyId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { legalName: { contains: search, mode: "insensitive" as const } },
              { businessCode: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { legalName: "asc" },
        include: { _count: { select: { deliveryPoints: true } } },
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({ items, total, page, pageSize });
  })
);

customersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId, deletedAt: null },
      include: { deliveryPoints: { where: { deletedAt: null } } },
    });
    if (!customer) throw HttpError.notFound("Cliente no encontrado");
    res.json(customer);
  })
);

customersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = customerSchema.parse(req.body);
    const existing = await prisma.customer.findFirst({
      where: { companyId: req.auth!.companyId, businessCode: data.businessCode },
    });
    if (existing) throw HttpError.conflict("Ya existe un cliente con ese código de negocio");

    const customer = await prisma.customer.create({
      data: { ...data, companyId: req.auth!.companyId },
    });
    res.status(201).json(customer);
  })
);

customersRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = customerSchema.partial().parse(req.body);
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!customer) throw HttpError.notFound("Cliente no encontrado");

    const updated = await prisma.customer.update({ where: { id: customer.id }, data });
    res.json(updated);
  })
);

customersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!customer) throw HttpError.notFound("Cliente no encontrado");
    // Soft delete: nunca se borra físicamente un maestro referenciado por pedidos históricos.
    await prisma.customer.update({ where: { id: customer.id }, data: { deletedAt: new Date(), active: false } });
    res.status(204).send();
  })
);
