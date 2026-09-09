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
//
// 2026-09-09: Raúl comparó esta página con el Portal Cliente autenticado y
// pidió paridad -- seguimiento en vivo, justificante de entrega (firma +
// fotos), valoración de satisfacción y reporte/consulta de incidencias.
// Antes esta consulta pública solo devolvía una línea de tiempo de 4-5
// pasos, mucho más pobre que `customer-portal.routes.ts` (que sí exponía
// todo eso, pero solo con login). Se añade aquí el mismo contenido,
// reutilizando los mismos modelos (ProofOfDelivery, DeliveryFeedback,
// Incident, TrackingEvent) y el mismo patrón de "última posición conocida"
// que ya usa `shipments.routes.ts` para el mapa de Seguimiento en
// Backoffice -- la diferencia es solo el criterio de acceso: en vez de un
// token de Portal Cliente, cada endpoint vuelve a exigir número de pedido +
// código postal en el propio body/query, así que un pedido nunca queda
// expuesto sin ese segundo dato aunque alguien adivine o comparta un id
// interno.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { trackingRateLimiter } from "@/middleware/tracking-rate-limit";

export const trackingRouter = Router();
trackingRouter.use(trackingRateLimiter);

const lookupSchema = z.object({
  orderNumber: z.string().min(1),
  postalCode: z.string().min(1),
});

// Mensaje idéntico en todos los "no encontrado" de este módulo -- si
// variase según el motivo (pedido inexistente vs. código postal erróneo vs.
// sin permiso para la acción concreta), alguien podría usar la propia
// respuesta para ir adivinando números de pedido o códigos postales válidos
// por descarte.
const NOT_FOUND_RESPONSE = {
  error: "not_found",
  message: "No se ha encontrado ningún pedido con ese número y código postal",
} as const;

// Único punto que resuelve "¿existe un pedido con este número Y este código
// postal?" -- los tres endpoints de más abajo (lookup, feedback, incidents)
// pasan siempre por aquí, así el criterio de acceso no puede quedar
// desincronizado entre ellos.
async function findPublicOrder(orderNumber: string, postalCode: string) {
  return prisma.order.findFirst({
    where: {
      orderNumber: { equals: orderNumber.trim(), mode: "insensitive" },
      deliveryPoint: { postalCode: postalCode.trim() },
    },
    include: {
      deliveryPoint: true,
      lines: { include: { product: { select: { description: true } } } },
      deliveryFeedback: true,
      routeStops: {
        include: {
          pod: true,
          incidents: {
            select: { id: true, incidentType: true, status: true, description: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          },
          route: {
            include: {
              shipment: {
                include: {
                  // Mismo patrón que shipments.routes.ts para el mapa de
                  // Seguimiento de Backoffice: último ping con coordenadas,
                  // sin traer todo el histórico de posiciones.
                  trackingEvents: {
                    where: { lat: { not: null }, lng: { not: null } },
                    orderBy: { occurredAt: "desc" },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

type PublicOrder = NonNullable<Awaited<ReturnType<typeof findPublicOrder>>>;

function getShipment(order: PublicOrder) {
  return order.routeStops[0]?.route?.shipment ?? null;
}

// GET /api/tracking/lookup?orderNumber=...&postalCode=...
trackingRouter.get(
  "/lookup",
  asyncHandler(async (req, res) => {
    const { orderNumber, postalCode } = lookupSchema.parse(req.query);
    const order = await findPublicOrder(orderNumber, postalCode);

    if (!order) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const shipment = getShipment(order);
    const stop = order.routeStops[0];
    const lastPosition = shipment?.trackingEvents[0];

    res.json({
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
      timeline: buildPublicTimeline(order),
      // Seguimiento en vivo: solo tiene sentido mientras el envío está
      // circulando -- una vez entregado o antes de cargar, la última
      // posición conocida no aporta nada útil y podría confundir (ej.
      // pensar que el camión sigue en un punto donde ya no está).
      livePosition:
        shipment && shipment.status === "in_transit" && lastPosition
          ? { lat: lastPosition.lat, lng: lastPosition.lng, occurredAt: lastPosition.occurredAt }
          : null,
      pod: stop?.pod
        ? {
            signatureUrl: stop.pod.signatureUrl,
            photoUrls: stop.pod.photoUrls,
            receivedByName: stop.pod.receivedByName,
            deliveredAt: stop.pod.deliveredAt,
          }
        : null,
      feedback: order.deliveryFeedback
        ? { rating: order.deliveryFeedback.rating, comment: order.deliveryFeedback.comment }
        : null,
      incidents: order.routeStops.flatMap((s) =>
        s.incidents.map((i) => ({
          incidentType: i.incidentType,
          status: i.status,
          description: i.description,
          createdAt: i.createdAt,
        }))
      ),
    });
  })
);

const feedbackSchema = z.object({
  orderNumber: z.string().min(1),
  postalCode: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
});

// POST /api/tracking/feedback -- valoración de satisfacción (1-5 +
// comentario opcional), equivalente público de
// `customer-portal.routes.ts` POST /orders/:orderId/feedback. Upsert: si ya
// se había valorado, se actualiza en vez de duplicar (mismo criterio).
trackingRouter.post(
  "/feedback",
  asyncHandler(async (req, res) => {
    const { orderNumber, postalCode, rating, comment } = feedbackSchema.parse(req.body);
    const order = await findPublicOrder(orderNumber, postalCode);

    if (!order) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    if (order.status !== "delivered") {
      throw HttpError.conflict("Solo se puede valorar un pedido ya entregado");
    }

    const feedback = await prisma.deliveryFeedback.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, rating, comment },
      update: { rating, comment },
    });

    res.status(201).json({ rating: feedback.rating, comment: feedback.comment });
  })
);

const incidentSchema = z.object({
  orderNumber: z.string().min(1),
  postalCode: z.string().min(1),
  incidentType: z.enum(["delay", "damage", "refused", "access_issue", "other"]),
  description: z.string().optional(),
});

// POST /api/tracking/incidents -- reporte de incidencia, equivalente
// público de `customer-portal.routes.ts` POST /orders/:orderId/incidents.
// Igual que allí, hace falta que el pedido ya tenga un envío en curso (una
// incidencia se asocia a un `Shipment`, no a un pedido todavía sin
// planificar).
trackingRouter.post(
  "/incidents",
  asyncHandler(async (req, res) => {
    const { orderNumber, postalCode, incidentType, description } = incidentSchema.parse(req.body);
    const order = await findPublicOrder(orderNumber, postalCode);

    if (!order) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const stop = order.routeStops[0];
    const shipment = getShipment(order);
    if (!shipment) {
      throw HttpError.conflict("El pedido todavía no tiene un envío en curso; no se puede reportar una incidencia todavía");
    }

    const incident = await prisma.incident.create({
      data: {
        shipmentId: shipment.id,
        routeStopId: stop?.id,
        incidentType,
        description,
        reportedBy: "public_tracking",
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

function buildPublicTimeline(order: PublicOrder) {
  const shipment = getShipment(order);

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
      label: order.routeStops[0]?.pod
        ? `Entregado${order.routeStops[0]!.pod!.receivedByName ? ` (recibido por ${order.routeStops[0]!.pod!.receivedByName})` : ""}`
        : "Entregado",
      done: order.status === "delivered",
    },
  ];

  const openIncident = order.routeStops.flatMap((s) => s.incidents).some((i) => i.status !== "resolved");
  if (openIncident) {
    steps.push({ key: "incident", label: "Incidencia en curso", done: true });
  }

  return steps;
}
