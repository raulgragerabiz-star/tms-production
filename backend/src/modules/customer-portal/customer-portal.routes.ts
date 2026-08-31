import { Router } from "express";
import { requireCustomerPortal } from "../../middleware/requireCustomerPortal";
import { prisma } from "../../lib/prisma";

const router = Router();

// GET /api/customer-portal/orders?search=<orderNumber>
// Documento v1.1 §7.1 — pantalla única: buscador + listado de pedidos propios.
// customerId SIEMPRE viene del token, nunca de query params (evita fuga de datos
// de otros clientes aunque alguien manipule la query).
router.get("/orders", requireCustomerPortal, async (req, res, next) => {
  try {
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

    return res.status(200).json({ orders });
  } catch (err) {
    next(err);
  }
});

// GET /api/customer-portal/orders/:orderId
// Timeline de estado (reutiliza los checkpoints ya existentes, modo solo lectura,
// documento v1.1 §7.1/§5.2). Sin coste ni datos de otros clientes.
router.get("/orders/:orderId", requireCustomerPortal, async (req, res, next) => {
  try {
    const customerId = req.auth!.customerId!;
    const { orderId } = req.params;

    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId }, // scope reforzado: nunca solo por orderId
      include: {
        deliveryPoint: true,
        orderLines: { include: { product: { select: { description: true } } } },
        routeStops: {
          include: {
            route: { include: { shipment: true } },
            proofOfDelivery: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: "order_not_found" });
    }

    const timeline = buildCustomerTimeline(order);

    return res.status(200).json({
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
        lines: order.orderLines.map((l) => ({
          product: l.product.description,
          quantity: l.quantity,
          unit: l.unit,
        })),
      },
      timeline,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/customer-portal/orders/:orderId/pod
// Descarga de POD cuando status = delivered (documento v1.1 §7.1).
router.get("/orders/:orderId/pod", requireCustomerPortal, async (req, res, next) => {
  try {
    const customerId = req.auth!.customerId!;
    const { orderId } = req.params;

    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId },
      include: {
        routeStops: { include: { proofOfDelivery: true } },
      },
    });

    if (!order || order.status !== "delivered") {
      return res.status(404).json({ error: "pod_not_available" });
    }

    const pod = order.routeStops.find((s) => s.proofOfDelivery)?.proofOfDelivery;
    if (!pod) {
      return res.status(404).json({ error: "pod_not_available" });
    }

    return res.status(200).json({
      signatureUrl: pod.signatureUrl,
      photoUrls: pod.photoUrls,
      receivedByName: pod.receivedByName,
      deliveredAt: pod.deliveredAt,
    });
  } catch (err) {
    next(err);
  }
});

function buildCustomerTimeline(order: any) {
  // Mapea sobre los 4 checkpoints ya congelados (documento v1.1 §5.2),
  // en modo solo lectura, sin exponer coste ni datos internos.
  const shipment = order.routeStops[0]?.route?.shipment;
  const steps = [
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
  return steps;
}

export default router;
