import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { computeLineWeightKg } from "./lib/line-weight";
import { classifyOrder } from "@/modules/segmentation/segmentation.service";

export const ordersRouter = Router();

const orderLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unit: z.string().min(1), // "UD" | "PAL" (palés completos) | otros
});

const orderSchema = z.object({
  orderNumber: z.string().min(1),
  customerId: z.string().uuid(),
  deliveryPointId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  priority: z.enum(["standard", "urgent"]).optional(),
  requestedDeliveryDate: z.coerce.date(),
  deliveryTimeWindowFrom: z.string().optional(),
  deliveryTimeWindowTo: z.string().optional(),
  notes: z.string().optional(),
  // Los 4 segmentos reales (columna `service_type`, ver ServiceType en el schema
  // de Prisma) — antes aceptaba "full_truck"/"pallet", 2 valores heredados que ya
  // no existen en el enum de la base de datos y hacían fallar cualquier alta con
  // ese campo relleno. Si se omite, el pedido se clasifica automáticamente por
  // peso/palés al crearlo (mismo motor que usa el bridge de importación ERP).
  serviceType: z.enum(["paqueteria", "paleteria", "paleteria_pesada", "gran_volumen"]).optional(),
  lines: z.array(orderLineSchema).min(1),
});

ordersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const page = parseInt((req.query.page as string) ?? "1", 10);
    const pageSize = Math.min(parseInt((req.query.pageSize as string) ?? "25", 10), 100);

    const where = {
      companyId: req.auth!.companyId,
      ...(status ? { status: status as any } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { requestedDeliveryDate: "asc" },
        include: {
          customer: { select: { businessCode: true, legalName: true } },
          deliveryPoint: { select: { id: true, address: true, city: true, lat: true, lng: true } },
          warehouse: { select: { id: true, name: true, lat: true, lng: true } },
          lines: true,
        },
      }),
      prisma.order.count({ where }),
    ]);

    const withTotals = items.map((o) => ({
      ...o,
      totalWeightKg: o.lines.reduce((acc, l) => acc + Number(l.lineWeightKg ?? 0), 0),
    }));

    res.json({ items: withTotals, total, page, pageSize });
  })
);

ordersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
      include: {
        customer: true,
        deliveryPoint: true,
        warehouse: true,
        lines: { include: { product: true } },
        documents: true,
        routeStops: { include: { route: true } },
      },
    });
    if (!order) throw HttpError.notFound("Pedido no encontrado");
    res.json(order);
  })
);

ordersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = orderSchema.parse(req.body);

    const [customer, deliveryPoint, warehouse] = await Promise.all([
      prisma.customer.findFirst({ where: { id: data.customerId, companyId: req.auth!.companyId } }),
      prisma.deliveryPoint.findFirst({ where: { id: data.deliveryPointId, customerId: data.customerId } }),
      prisma.warehouse.findFirst({ where: { id: data.warehouseId, companyId: req.auth!.companyId } }),
    ]);
    if (!customer) throw HttpError.notFound("Cliente no encontrado");
    if (!deliveryPoint) throw HttpError.notFound("Punto de entrega no válido para este cliente");
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado");

    const productIds = data.lines.map((l) => l.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds }, companyId: req.auth!.companyId } });
    if (products.length !== new Set(productIds).size) {
      throw HttpError.badRequest("Uno o más productos de las líneas no existen en el catálogo");
    }
    const productMap = new Map(products.map((p) => [p.id, p]));

    const order = await prisma.order.create({
      data: {
        companyId: req.auth!.companyId,
        orderNumber: data.orderNumber,
        customerId: data.customerId,
        deliveryPointId: data.deliveryPointId,
        warehouseId: data.warehouseId,
        priority: data.priority ?? "standard",
        requestedDeliveryDate: data.requestedDeliveryDate,
        deliveryTimeWindowFrom: data.deliveryTimeWindowFrom,
        deliveryTimeWindowTo: data.deliveryTimeWindowTo,
        notes: data.notes,
        serviceType: data.serviceType,
        status: "validated",
        lines: {
          create: data.lines.map((l) => {
            const product = productMap.get(l.productId)!;
            return {
              productId: l.productId,
              quantity: l.quantity,
              unit: l.unit,
              lineWeightKg: computeLineWeightKg(l.unit, l.quantity, {
                grossWeightKg: Number(product.grossWeightKg),
                fullPalletWeightKg: Number(product.fullPalletWeightKg),
              }),
            };
          }),
        },
      },
      include: { lines: true },
    });

    // Si el planificador no fijó un tipo de servicio explícito, se clasifica
    // automáticamente por peso/palés — mismo motor que usa el bridge de
    // importación del ERP, para que un pedido manual y uno importado se
    // traten igual en vez de depender de que la persona adivine el segmento.
    if (!data.serviceType) {
      await prisma.$transaction((tx) => classifyOrder(tx, req.auth!.companyId, order.id));
    }

    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
    res.status(201).json(finalOrder);
  })
);

const statusTransitions: Record<string, string[]> = {
  received: ["validated", "cancelled"],
  validated: ["planned", "cancelled"],
  planned: ["loading", "cancelled"],
  loading: ["dispatched"],
  dispatched: ["in_transit"],
  in_transit: ["delivered", "incident"],
  incident: ["in_transit", "delivered"],
  delivered: [],
  cancelled: [],
};

ordersRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const schema = z.object({ status: z.enum(Object.keys(statusTransitions) as [string, ...string[]]) });
    const { status } = schema.parse(req.body);

    const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!order) throw HttpError.notFound("Pedido no encontrado");

    const allowed = statusTransitions[order.status] ?? [];
    if (!allowed.includes(status)) {
      throw HttpError.badRequest(`Transición no permitida: ${order.status} -> ${status}`);
    }

    const updated = await prisma.order.update({ where: { id: order.id }, data: { status: status as any } });
    res.json(updated);
  })
);
