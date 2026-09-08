// Portal Cliente: acceso de solo lectura a los pedidos propios del cliente autenticado.
// customerId SIEMPRE viene del token, nunca de query params (evita fuga de datos de
// otros clientes aunque alguien manipule la query).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
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
        // Objetivo 4: para que el cliente vea si ya valoró este pedido (y con
        // qué nota) en vez de que se le vuelva a pedir cada vez que entra.
        deliveryFeedback: true,
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
      feedback: order.deliveryFeedback
        ? { rating: order.deliveryFeedback.rating, comment: order.deliveryFeedback.comment }
        : null,
    });
  })
);

// POST /api/customer-portal/orders/:orderId/incidents — el cliente reporta una
// incidencia sobre su propio pedido. Reutiliza el mismo modelo Incident que ya
// usan Backoffice/App Conductor, solo que aquí "reportedBy" identifica que
// viene del Portal Cliente en vez de un usuario interno o el conductor.
customerPortalRouter.post(
  "/orders/:orderId/incidents",
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.customerId!;
    const { orderId } = req.params;

    const schema = z.object({
      incidentType: z.enum(["delay", "damage", "refused", "access_issue", "other"]),
      description: z.string().optional(),
    });
    const data = schema.parse(req.body);

    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId },
      include: { routeStops: { include: { route: { include: { shipment: true } } } } },
    });
    if (!order) throw HttpError.notFound("Pedido no encontrado");

    const stop = order.routeStops[0];
    const shipment = stop?.route?.shipment;
    if (!shipment) {
      throw HttpError.conflict("El pedido todavía no tiene un envío en curso; no se puede reportar una incidencia todavía");
    }

    const incident = await prisma.incident.create({
      data: {
        shipmentId: shipment.id,
        routeStopId: stop?.id,
        incidentType: data.incidentType,
        description: data.description,
        reportedBy: `customer_portal:${customerId}`,
      },
    });

    res.status(201).json({
      id: incident.id,
      incidentType: incident.incidentType,
      description: incident.description,
      status: incident.status,
      createdAt: incident.createdAt,
    });
  })
);

// POST /api/customer-portal/orders/:orderId/feedback — valoración de satisfacción
// (1-5 + comentario opcional), solo disponible una vez entregado el pedido.
// Upsert: si el cliente ya había valorado, se actualiza en vez de duplicar.
customerPortalRouter.post(
  "/orders/:orderId/feedback",
  asyncHandler(async (req, res) => {
    const customerId = req.auth!.customerId!;
    const { orderId } = req.params;

    const schema = z.object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().optional(),
    });
    const data = schema.parse(req.body);

    const order = await prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!order) throw HttpError.notFound("Pedido no encontrado");
    if (order.status !== "delivered") {
      throw HttpError.conflict("Solo se puede valorar un pedido ya entregado");
    }

    const feedback = await prisma.deliveryFeedback.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, rating: data.rating, comment: data.comment },
      update: { rating: data.rating, comment: data.comment },
    });

    res.status(201).json({ rating: feedback.rating, comment: feedback.comment });
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

  // Objetivo 4: antes el estado "incident" del pedido solo se veía como badge
  // en el listado -- la línea de tiempo del detalle nunca lo reflejaba. Paso
  // adicional, solo aparece cuando aplica; no cambia nada de los 4 pasos ya
  // existentes.
  if (order.status === "incident") {
    steps.push({ key: "incident", label: "Incidencia en curso", done: true });
  }

  return steps;
}