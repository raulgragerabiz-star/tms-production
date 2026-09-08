// App Conductor (Fase 13): acceso limitado a la ruta del día del conductor autenticado.
// Nunca datos de otros conductores ni información comercial (tarifas, coste).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { requireDriverApp } from "@/middleware/scoped-auth";

export const driverAppRouter = Router();
driverAppRouter.use(requireDriverApp);

// Ruta diaria: paradas del día en orden, con dirección, ventana horaria y resumen del pedido.
driverAppRouter.get(
  "/today-route",
  asyncHandler(async (req, res) => {
    const driverId = req.auth!.driverId!;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const shipment = await prisma.shipment.findFirst({
      where: {
        driverId,
        status: { in: ["programmed", "loaded", "in_transit"] },
        route: { routeDate: { gte: today, lt: tomorrow } },
      },
      include: {
        vehicle: { include: { vehicleType: true } },
        route: {
          include: {
            warehouse: true,
            stops: {
              orderBy: { sequence: "asc" },
              include: {
                order: { include: { deliveryPoint: true, customer: true, lines: { include: { product: true } } } },
                pod: true,
              },
            },
          },
        },
      },
    });

    if (!shipment) return res.json({ shipment: null });
    res.json({ shipment });
  })
);

// Cambio de estado de parada (llegada, entrega completada/fallida) + firma/foto
driverAppRouter.post(
  "/stops/:routeStopId/arrive",
  asyncHandler(async (req, res) => {
    const stop = await prisma.routeStop.findFirst({
      where: { id: req.params.routeStopId, route: { shipment: { driverId: req.auth!.driverId! } } },
    });
    if (!stop) throw HttpError.notFound("Parada no encontrada");
    const updated = await prisma.routeStop.update({ where: { id: stop.id }, data: { status: "arrived" } });

    const shipment = await prisma.shipment.findUnique({ where: { routeId: stop.routeId } });
    if (shipment) {
      await prisma.trackingEvent.create({
        data: { shipmentId: shipment.id, eventType: "stop_arrival", occurredAt: new Date(), payload: { routeStopId: stop.id } },
      });
    }
    res.json(updated);
  })
);

driverAppRouter.post(
  "/stops/:routeStopId/complete",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      signatureUrl: z.string().optional(),
      photoUrls: z.array(z.string()).optional(),
      receivedByName: z.string().optional(),
      failed: z.boolean().optional(),
      failureReason: z.string().optional(),
      // Objetivo 3: checkpoint "retorno" -- la mercancia no llega a
      // entregarse y el conductor la trae de vuelta (p.ej. cliente cerrado
      // o rechazo total). Distinto de `failed`, que es una incidencia
      // puntual de entrega; aqui no se marca el pedido como "delivered" ni
      // se reclaman retornos pendientes del cliente.
      returned: z.boolean().optional(),
    });
    const data = schema.parse(req.body);

    const stop = await prisma.routeStop.findFirst({
      where: { id: req.params.routeStopId, route: { shipment: { driverId: req.auth!.driverId! } } },
      include: { order: true },
    });
    if (!stop) throw HttpError.notFound("Parada no encontrada");

    await prisma.$transaction(async (tx) => {
      const nextStatus = data.returned ? "returned" : data.failed ? "failed" : "completed";
      await tx.routeStop.update({ where: { id: stop.id }, data: { status: nextStatus } });

      if (data.returned) {
        const shipment = await tx.shipment.findUnique({ where: { routeId: stop.routeId } });
        if (shipment) {
          await tx.incident.create({
            data: {
              shipmentId: shipment.id,
              routeStopId: stop.id,
              incidentType: "other",
              description: data.failureReason ?? "Retorno a almacén reportado desde App Conductor",
              reportedBy: req.auth!.sub,
            },
          });
        }
        return;
      }

      if (data.failed) {
        const shipment = await tx.shipment.findUnique({ where: { routeId: stop.routeId } });
        if (shipment) {
          await tx.incident.create({
            data: {
              shipmentId: shipment.id,
              routeStopId: stop.id,
              incidentType: "refused",
              description: data.failureReason ?? "Entrega fallida reportada desde App Conductor",
              reportedBy: req.auth!.sub,
            },
          });
        }
        return;
      }

      await tx.proofOfDelivery.upsert({
        where: { routeStopId: stop.id },
        create: {
          routeStopId: stop.id,
          signatureUrl: data.signatureUrl,
          photoUrls: data.photoUrls,
          receivedByName: data.receivedByName,
          deliveredAt: new Date(),
        },
        update: {
          signatureUrl: data.signatureUrl,
          photoUrls: data.photoUrls,
          receivedByName: data.receivedByName,
          deliveredAt: new Date(),
        },
      });
      await tx.order.update({ where: { id: stop.orderId }, data: { status: "delivered" } });

      // Reclamación automática de retornos pendientes del cliente (mismo comportamiento que
      // el backoffice, Fase 4 paso 11), disponible también desde la app en campo.
      const shipment = await tx.shipment.findUnique({ where: { routeId: stop.routeId } });
      if (shipment) {
        // Objetivo 4 (Portal Cliente): la línea de tiempo que ve el cliente marca "En ruta"
        // cuando shipment.status es in_transit/finished. Si el conductor entrega una parada
        // sin haber pulsado antes "Salgo de reparto" (checkpoint aparte, más arriba en este
        // fichero), el shipment se quedaría en programmed/loaded para siempre aunque el
        // pedido ya conste como entregado -- el cliente vería "Entregado" pero "En ruta" sin
        // marcar, algo incoherente. Se adelanta aquí automáticamente como red de seguridad.
        if (shipment.status === "programmed" || shipment.status === "loaded") {
          await tx.shipment.update({
            where: { id: shipment.id },
            data: { status: "in_transit", departedAt: shipment.departedAt ?? new Date() },
          });
        }

        const pendingReturns = await tx.returnItem.findMany({ where: { customerId: stop.order.customerId, status: "pending" } });
        for (const ri of pendingReturns) {
          await tx.returnClaim.create({
            data: { shipmentId: shipment.id, returnItemId: ri.id, claimedQuantity: ri.pendingQuantity, status: "pending" },
          });
          await tx.returnItem.update({ where: { id: ri.id }, data: { status: "claimed" } });
        }
      }
    });

    const updated = await prisma.routeStop.findUnique({ where: { id: stop.id }, include: { pod: true } });
    res.json(updated);
  })
);

// Objetivo 3: checkpoints "cargado" / "en reparto" (y cierre "finalizado") del
// envío completo, accesibles desde la App Conductor -- hasta ahora solo existía
// el equivalente interno (PATCH /api/shipments/:id/status), montado bajo auth
// de backoffice y por tanto inalcanzable para el conductor en campo. Mismas
// reglas de negocio que el endpoint interno (departedAt/finishedAt, no se
// puede finalizar con paradas sin completar), pero solo transiciones hacia
// adelante y solo sobre el propio shipment del conductor autenticado.
const SHIPMENT_STATUS_ORDER = ["programmed", "loaded", "in_transit", "finished"] as const;

driverAppRouter.post(
  "/shipments/:id/status",
  asyncHandler(async (req, res) => {
    const schema = z.object({ status: z.enum(SHIPMENT_STATUS_ORDER) });
    const { status } = schema.parse(req.body);

    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, driverId: req.auth!.driverId! } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");

    const currentIdx = SHIPMENT_STATUS_ORDER.indexOf(shipment.status as (typeof SHIPMENT_STATUS_ORDER)[number]);
    const nextIdx = SHIPMENT_STATUS_ORDER.indexOf(status);
    if (nextIdx <= currentIdx) {
      throw HttpError.conflict(`No se puede pasar de "${shipment.status}" a "${status}" (solo hacia adelante)`);
    }

    const data: any = { status };
    if (status === "in_transit" && !shipment.departedAt) data.departedAt = new Date();
    if (status === "finished") {
      data.finishedAt = new Date();
      const pending = await prisma.routeStop.count({ where: { routeId: shipment.routeId, status: { notIn: ["completed", "failed", "returned"] } } });
      if (pending > 0) throw HttpError.conflict("Hay paradas sin completar; no se puede finalizar el envío");
    }

    const updated = await prisma.shipment.update({ where: { id: shipment.id }, data });
    res.json(updated);
  })
);

// GPS: posición continua mientras la app está activa en ruta
driverAppRouter.post(
  "/gps-ping",
  asyncHandler(async (req, res) => {
    const schema = z.object({ shipmentId: z.string().uuid(), lat: z.number(), lng: z.number() });
    const data = schema.parse(req.body);

    const shipment = await prisma.shipment.findFirst({ where: { id: data.shipmentId, driverId: req.auth!.driverId! } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");

    const event = await prisma.trackingEvent.create({
      data: { shipmentId: shipment.id, eventType: "gps_ping", lat: data.lat, lng: data.lng, occurredAt: new Date() },
    });
    res.status(201).json(event);
  })
);

// Incidencias desde parada afectada
driverAppRouter.post(
  "/incidents",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      shipmentId: z.string().uuid(),
      routeStopId: z.string().uuid().optional(),
      incidentType: z.enum(["delay", "damage", "refused", "access_issue", "other"]),
      description: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const shipment = await prisma.shipment.findFirst({ where: { id: data.shipmentId, driverId: req.auth!.driverId! } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");

    const incident = await prisma.incident.create({
      data: {
        shipmentId: shipment.id,
        routeStopId: data.routeStopId,
        incidentType: data.incidentType,
        description: data.description,
        reportedBy: req.auth!.sub,
      },
    });
    res.status(201).json(incident);
  })
);

// Documentos de una parada (albarán/carta de porte) — visualización offline se resuelve
// en el cliente (cacheado al iniciar sesión); aquí solo se sirve el contenido.
driverAppRouter.get(
  "/stops/:routeStopId/documents",
  asyncHandler(async (req, res) => {
    const stop = await prisma.routeStop.findFirst({
      where: { id: req.params.routeStopId, route: { shipment: { driverId: req.auth!.driverId! } } },
      include: { order: { include: { documents: true } } },
    });
    if (!stop) throw HttpError.notFound("Parada no encontrada");
    res.json({ items: stop.order.documents });
  })
);

// Chat (mismo canal que Portal Transportista)
driverAppRouter.get(
  "/shipments/:id/messages",
  asyncHandler(async (req, res) => {
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, driverId: req.auth!.driverId! } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");
    const items = await prisma.shipmentMessage.findMany({ where: { shipmentId: shipment.id }, orderBy: { createdAt: "asc" } });
    res.json({ items });
  })
);

driverAppRouter.post(
  "/shipments/:id/messages",
  asyncHandler(async (req, res) => {
    const schema = z.object({ body: z.string().min(1) });
    const { body } = schema.parse(req.body);
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, driverId: req.auth!.driverId! } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");

    const message = await prisma.shipmentMessage.create({
      data: { shipmentId: shipment.id, senderType: "driver_app", senderName: req.auth!.email, body },
    });
    res.status(201).json(message);
  })
);
