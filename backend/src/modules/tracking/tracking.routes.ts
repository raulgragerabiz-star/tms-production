// Consulta pública de estado de pedido, sin usuario ni contraseña.
//
// Decisión explícita de Raúl (tras probar la carga de pedidos por Excel):
// dar de alta un cliente + un usuario de Portal Cliente por cada pedido de
// prueba era demasiada gestión para lo que hace falta -- "sería más
// recomendable y práctico hacer un acceso único para todos, con la única
// diferencia de visibilidad por consulta de número de pedido... ahorraríamos
// creaciones de clientes, pérdidas de contraseñas". Este módulo es ese
// acceso único: cualquiera que sepa el Nº de pedido Y el código postal de la
// entrega (igual que cualquier transportista de mercado: no basta con el
// número de seguimiento, hace falta un segundo dato que solo conoce quien
// hizo o recibe el pedido) puede consultar SOLO el estado de ese pedido, sin
// ver nada del resto de pedidos del cliente ni datos internos (coste,
// observaciones internas, otros clientes...).
//
// El Portal Cliente con usuario/contraseña (`customer-portal.routes.ts`)
// sigue existiendo tal cual para quien ya lo tuviera configurado -- esto es
// una vía adicional, no un reemplazo.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { trackingRateLimiter } from "@/middleware/tracking-rate-limit";

export const trackingRouter = Router();
trackingRouter.use(trackingRateLimiter);

const lookupSchema = z.object({
  orderNumber: z.string().min(1),
  postalCode: z.string().min(1),
});

// GET /api/tracking/lookup?orderNumber=...&postalCode=...
trackingRouter.get(
  "/lookup",
  asyncHandler(async (req, res) => {
    const { orderNumber, postalCode } = lookupSchema.parse(req.query);

    const order = await prisma.order.findFirst({
      where: {
        orderNumber: { equals: orderNumber.trim(), mode: "insensitive" },
        deliveryPoint: { postalCode: postalCode.trim() },
      },
      include: {
        deliveryPoint: { select: { city: true } },
        routeStops: {
          include: {
            route: { include: { shipment: true } },
            pod: { select: { deliveredAt: true, receivedByName: true } },
            incidents: { select: { incidentType: true, status: true } },
          },
        },
      },
    });

    // Mensaje idéntico exista o no el pedido, y coincida o no el código
    // postal -- si variase, alguien podría usar la propia respuesta para ir
    // adivinando números de pedido o códigos postales válidos por descarte.
    if (!order) {
      return res
        .status(404)
        .json({ error: "not_found", message: "No se ha encontrado ningún pedido con ese número y código postal" });
    }

    res.json({
      orderNumber: order.orderNumber,
      status: order.status,
      requestedDeliveryDate: order.requestedDeliveryDate,
      city: order.deliveryPoint.city,
      timeline: buildPublicTimeline(order),
    });
  })
);

function buildPublicTimeline(order: {
  status: string;
  routeStops: {
    route: { shipment: { status: string } | null };
    pod: { deliveredAt: Date; receivedByName: string | null } | null;
    incidents: { incidentType: string; status: string }[];
  }[];
}) {
  const stop = order.routeStops[0];
  const shipment = stop?.route?.shipment;

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
      label: stop?.pod ? `Entregado${stop.pod.receivedByName ? ` (recibido por ${stop.pod.receivedByName})` : ""}` : "Entregado",
      done: order.status === "delivered",
    },
  ];

  const openIncident = order.routeStops.flatMap((s) => s.incidents).some((i) => i.status !== "resolved");
  if (openIncident) {
    steps.push({ key: "incident", label: "Incidencia en curso", done: true });
  }

  return steps;
}
