import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";

export const returnsRouter = Router();

returnsRouter.get(
  "/items",
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const items = await prisma.returnItem.findMany({
      where: { customer: { companyId: req.auth!.companyId }, ...(status ? { status: status as any } : {}) },
      include: { customer: { select: { legalName: true, businessCode: true } }, claims: true },
      orderBy: { id: "desc" },
    });
    res.json({ items, total: items.length });
  })
);

returnsRouter.post(
  "/items",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      customerId: z.string().uuid(),
      itemDescription: z.string().min(1),
      pendingQuantity: z.number().positive(),
      notes: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const customer = await prisma.customer.findFirst({ where: { id: data.customerId, companyId: req.auth!.companyId } });
    if (!customer) throw HttpError.notFound("Cliente no encontrado");

    const item = await prisma.returnItem.create({ data });
    res.status(201).json(item);
  })
);

returnsRouter.post(
  "/claims/:id/collect",
  asyncHandler(async (req, res) => {
    const schema = z.object({ collectedQuantity: z.number().nonnegative() });
    const { collectedQuantity } = schema.parse(req.body);

    const claim = await prisma.returnClaim.findFirst({
      where: { id: req.params.id, shipment: { route: { companyId: req.auth!.companyId } } },
    });
    if (!claim) throw HttpError.notFound("Reclamación no encontrada");

    await prisma.$transaction([
      prisma.returnClaim.update({ where: { id: claim.id }, data: { collectedQuantity, status: "collected" } }),
      prisma.returnItem.update({ where: { id: claim.returnItemId }, data: { status: "collected" } }),
    ]);

    res.json({ ok: true });
  })
);

returnsRouter.post(
  "/claims/:id/not-available",
  asyncHandler(async (req, res) => {
    const claim = await prisma.returnClaim.findFirst({
      where: { id: req.params.id, shipment: { route: { companyId: req.auth!.companyId } } },
    });
    if (!claim) throw HttpError.notFound("Reclamación no encontrada");

    await prisma.$transaction([
      prisma.returnClaim.update({ where: { id: claim.id }, data: { status: "not_available" } }),
      prisma.returnItem.update({ where: { id: claim.returnItemId }, data: { status: "pending" } }), // vuelve a pending para próximo viaje
    ]);

    res.json({ ok: true });
  })
);
