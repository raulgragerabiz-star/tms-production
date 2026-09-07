// Portal Cliente: acceso de solo lectura a los pedidos propios del cliente autenticado.
// customerId SIEMPRE viene del token, nunca de query params (evita fuga de datos de
// otros clientes aunque alguien manipule la query).
import { Router } from "express";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { requireCustomerPortal } from "@/middleware/scoped-auth";

export const customerPortalRouter = Router();
customerPortalRouter.use(requireCustomerPortal);

// GET /api/customer-portal/orders?search=<orderNumber>
customerPortalRouter.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const { search } = req.query as { search?: string };
    const customerId = req.auth!.customerId!;

    const orders = await prisma.order.findMany({
      where: {
        customerId,
        ...(search ? { orderNumber: { contains: search, mode: "insensitive" } } : {}),
      },
      orderBy: { requestedDeliveryDate: "desc" },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        requestedDeliveryDate: true,
        serviceType: true,
        deliveryPoint: { select: { label: true, city: true } },
      },
    });

    res.json({ orders });
  })
);

// GET /api/customer-portal/orders/:orderId — timeline de estado, sin coste ni datos internos.
customerPortalRouter.get(
  "/orders/:orderId",
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.customerId!;
    const { orderId } = req.params;

    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId }, // scope reforzado: nunca solo por orderId
      include: {
        deliveryPoint: true,
        lines: { include: { product: { select: { description: true } } } },
        routeStops: {
          include: {
            route: { include: { shipment: true } },
            pod: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: "order_not_found" });
    }

    const timeline = buildCustomerTimeline(order);

    res.json({
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        requestedDeliveryDate: order.requestedDeliveryDate,
        deliveryPoint: {
          label: order.deliveryPoint.label,
          address: order.deliveryPoint.address,
          city: order.deliveryPoint.city,
        },
        lines: order.lines.map((l) => ({
          product: l.product.description,
          quantity: l.quantity,
          unit: l.unit,
        })),
      },
      timeline,
    });
  })
);

// GET /api/customer-portal/orders/:orderId/pod — descarga de POD cuando status = delivered.
customerPortalRouter.get(
  "/orders/:orderId/pod",
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.customerId!;
    const { orderId } = req.params;

    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId },
      include: {
        routeStops: { include: { pod: true } },
      },
    });

    if (!order || order.status !== "delivered") {
      return res.status(404).json({ error: "pod_not_available" });
    }

    const pod = order.routeStops.find((s) => s.pod)?.pod;
    if (!pod) {
      return res.status(404).json({ error: "pod_not_available" });
    }

    res.json({
      signatureUrl: pod.signatureUrl,
      photoUrls: pod.photoUrls,
      receivedByName: pod.receivedByName,
      deliveredAt: pod.deliveredAt,
    });
  })
);

function buildCustomerTimeline(order: any) {
  // Mapea sobre los checkpoints de shipment/pedido, en modo solo lectura.
  const shipment = order.routeStops[0]?.route?.shipment;
  return [
    { key: "received", label: "Pedido recibido", done: true },
    {
      key: "loaded",
      label: "Carga confirmada",
      done: !!shipment && ["loaded", "in_transit", "finished"].includes(shipment.status),
    },
    {
      key: "in_transit",
      label: "En ruta",
      done: !!shipment && ["in_transit", "finished"].includes(shipment.status),
    },
    {
      key: "delivered",
      label: "Entregado",
      done: order.status === "delivered",
    },
  ];
}