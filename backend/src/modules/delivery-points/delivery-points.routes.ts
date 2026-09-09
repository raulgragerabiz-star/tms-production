import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { geocodeAddress } from "@/modules/routing/ors.service";

export const deliveryPointsRouter = Router();

// Fase 6: si no se ha indicado lat/lng a mano pero sí una dirección, se
// intenta geocodificar automáticamente con OpenRouteService. Puramente aditivo
// -- si no hay clave ORS configurada, si la dirección no se reconoce, o si la
// llamada falla por lo que sea, se guarda exactamente igual que antes (sin
// coordenadas), nunca bloquea la creación/edición del punto de entrega.
async function geocodeIfMissing<T extends { address?: string; postalCode?: string; city?: string; province?: string; country?: string; lat?: number; lng?: number }>(
  data: T
): Promise<T> {
  if (data.lat != null || data.lng != null || !data.address) return data;
  try {
    const result = await geocodeAddress({
      address: data.address,
      postalCode: data.postalCode,
      city: data.city,
      province: data.province,
      country: data.country,
    });
    if (result) return { ...data, lat: result.lat, lng: result.lng };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[geocoding] no se pudo geocodificar la dirección automáticamente:", (err as Error)?.message ?? err);
  }
  return data;
}

const dpSchema = z.object({
  customerId: z.string().uuid(),
  label: z.string().optional(),
  address: z.string().min(1),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  country: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  unloadHoursJson: z.any().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  exchangesPallets: z.boolean().optional(),
});

deliveryPointsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const customerId = req.query.customerId as string | undefined;
    const items = await prisma.deliveryPoint.findMany({
      where: {
        deletedAt: null,
        ...(customerId ? { customerId } : {}),
        customer: { companyId: req.auth!.companyId },
      },
      include: { customer: { select: { businessCode: true, legalName: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ items, total: items.length });
  })
);

deliveryPointsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = dpSchema.parse(req.body);
    const customer = await prisma.customer.findFirst({
      where: { id: data.customerId, companyId: req.auth!.companyId },
    });
    if (!customer) throw HttpError.notFound("Cliente no encontrado");
    const dp = await prisma.deliveryPoint.create({ data: await geocodeIfMissing(data) });
    res.status(201).json(dp);
  })
);

deliveryPointsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = dpSchema.partial().parse(req.body);
    const dp = await prisma.deliveryPoint.findFirst({
      where: { id: req.params.id, customer: { companyId: req.auth!.companyId } },
    });
    if (!dp) throw HttpError.notFound("Punto de entrega no encontrado");
    const updated = await prisma.deliveryPoint.update({ where: { id: dp.id }, data: await geocodeIfMissing(data) });
    res.json(updated);
  })
);

deliveryPointsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const dp = await prisma.deliveryPoint.findFirst({
      where: { id: req.params.id, customer: { companyId: req.auth!.companyId } },
    });
    if (!dp) throw HttpError.notFound("Punto de entrega no encontrado");
    await prisma.deliveryPoint.update({ where: { id: dp.id }, data: { deletedAt: new Date(), active: false } });
    res.status(204).send();
  })
);
