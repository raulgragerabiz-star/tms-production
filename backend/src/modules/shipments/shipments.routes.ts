import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";

export const shipmentsRouter = Router();

shipmentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const items = await prisma.shipment.findMany({
      where: { route: { companyId: req.auth!.companyId }, ...(status ? { status: status as any } : {}) },
      include: {
        route: {
          include: {
            warehouse: { select: { name: true } },
            stops: {
              orderBy: { sequence: "asc" },
              include: {
                order: {
                  select: {
                    orderNumber: true,
                    customer: { select: { legalName: true } },
                    deliveryPoint: { select: { address: true, city: true } },
                  },
                },
              },
            },
          },
        },
        carrier: { select: { legalName: true } },
        vehicle: { select: { plate: true } },
        driver: { select: { fullName: true } },
        // Sincronización en tiempo real: último ping conocido de cada envío,
        // para pintar la posición en el mapa de Seguimiento sin tener que
        // pedir el histórico completo por cada fila.
        trackingEvents: {
          where: { lat: { not: null }, lng: { not: null } },
          orderBy: { occurredAt: "desc" },
          take: 1,
        },
      },
      orderBy: { departedAt: "desc" },
    });
    res.json({
      items: items.map((s) => {
        const { trackingEvents, ...rest } = s;
        return { ...rest, lastPosition: trackingEvents[0] ?? null };
      }),
      total: items.length,
    });
  })
);

// Histórico de posiciones/eventos de un envío, para el panel de detalle del
// mapa de Seguimiento (despacho ve exactamente lo que ha ido reportando el
// conductor: pings GPS, llegadas/salidas de parada, cambios de estado).
shipmentsRouter.get(
  "/:id/tracking-events",
  asyncHandler(async (req, res) => {
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, route: { companyId: req.auth!.companyId } } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");

    const items = await prisma.trackingEvent.findMany({
      where: { shipmentId: shipment.id },
      orderBy: { occurredAt: "desc" },
      take: 200,
    });
    res.json({ items, total: items.length });
  })
);

// Crea el shipment a partir de una ruta ya `assigned`/`confirmed`.
shipmentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const schema = z.object({ routeId: z.string().uuid(), driverId: z.string().uuid().optional() });
    const { routeId, driverId } = schema.parse(req.body);

    const route = await prisma.route.findFirst({ where: { id: routeId, companyId: req.auth!.companyId } });
    if (!route) throw HttpError.notFound("Ruta no encontrada");
    if (!route.carrierId || !route.vehicleId) throw HttpError.badRequest("La ruta no tiene transportista/vehículo asignado");

    const shipment = await prisma.shipment.create({
      data: { routeId: route.id, carrierId: route.carrierId, vehicleId: route.vehicleId, driverId, status: "programmed" },
    });
    res.status(201).json(shipment);
  })
);

// Asigna/reasigna el conductor de un envío ya creado -- por ejemplo cuando se
// creó sin conductor todavía, o si hay que cambiarlo antes de que empiece la
// ruta. Sin restricción de estado: mientras no esté "finished" tiene sentido
// poder corregirlo (igual de flexible que el resto de asignaciones manuales
// del Planificador).
shipmentsRouter.patch(
  "/:id/driver",
  asyncHandler(async (req, res) => {
    const schema = z.object({ driverId: z.string().uuid() });
    const { driverId } = schema.parse(req.body);

    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, route: { companyId: req.auth!.companyId } } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");
    if (shipment.status === "finished") throw HttpError.conflict("El envío ya está finalizado");

    const driver = await prisma.driver.findFirst({ where: { id: driverId, carrierId: shipment.carrierId } });
    if (!driver) throw HttpError.notFound("Conductor no encontrado para el transportista de este envío");

    const updated = await prisma.shipment.update({ where: { id: shipment.id }, data: { driverId } });
    res.json(updated);
  })
);

shipmentsRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const schema = z.object({ status: z.enum(["programmed", "loaded", "in_transit", "finished"]) });
    const { status } = schema.parse(req.body);

    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, route: { companyId: req.auth!.companyId } } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");

    const data: any = { status };
    if (status === "in_transit" && !shipment.departedAt) data.departedAt = new Date();
    if (status === "finished") {
      data.finishedAt = new Date();
      const pending = await prisma.routeStop.count({ where: { routeId: shipment.routeId, status: { notIn: ["completed", "failed"] } } });
      if (pending > 0) throw HttpError.conflict("Hay paradas sin completar; no se puede finalizar el envío");
    }

    const updated = await prisma.shipment.update({ where: { id: shipment.id }, data });
    res.json(updated);
  })
);

shipmentsRouter.post(
  "/stops/:routeStopId/complete",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      signatureUrl: z.string().optional(),
      photoUrls: z.array(z.string()).optional(),
      receivedByName: z.string().optional(),
      failed: z.boolean().optional(),
    });
    const data = schema.parse(req.body);

    const stop = await prisma.routeStop.findFirst({
      where: { id: req.params.routeStopId, route: { companyId: req.auth!.companyId } },
      include: { order: true },
    });
    if (!stop) throw HttpError.notFound("Parada no encontrada");

    await prisma.$transaction(async (tx) => {
      await tx.routeStop.update({ where: { id: stop.id }, data: { status: data.failed ? "failed" : "completed" } });

      if (!data.failed) {
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

        // Retornos: al confirmar entrega, se reclaman automáticamente los return_item pendientes del cliente.
        const shipment = await tx.shipment.findUnique({ where: { routeId: stop.routeId } });
        if (shipment) {
          const pendingReturns = await tx.returnItem.findMany({
            where: { customerId: stop.order.customerId, status: "pending" },
          });
          for (const ri of pendingReturns) {
            await tx.returnClaim.create({
              data: { shipmentId: shipment.id, returnItemId: ri.id, claimedQuantity: ri.pendingQuantity, status: "pending" },
            });
            await tx.returnItem.update({ where: { id: ri.id }, data: { status: "claimed" } });
          }
        }
      }
    });

    const stopUpdated = await prisma.routeStop.findUnique({ where: { id: stop.id }, include: { pod: true } });
    res.json(stopUpdated);
  })
);

shipmentsRouter.post(
  "/:id/tracking",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      eventType: z.enum(["gps_ping", "stop_arrival", "stop_departure", "status_change"]),
      lat: z.number().optional(),
      lng: z.number().optional(),
      payload: z.any().optional(),
    });
    const data = schema.parse(req.body);
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, route: { companyId: req.auth!.companyId } } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");

    const event = await prisma.trackingEvent.create({
      data: { shipmentId: shipment.id, eventType: data.eventType, lat: data.lat, lng: data.lng, payload: data.payload, occurredAt: new Date() },
    });
    res.status(201).json(event);
  })
);

shipmentsRouter.post(
  "/:id/incidents",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      routeStopId: z.string().uuid().optional(),
      incidentType: z.enum(["delay", "damage", "refused", "access_issue", "other"]),
      description: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, route: { companyId: req.auth!.companyId } } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");

    const incident = await prisma.incident.create({
      data: { shipmentId: shipment.id, routeStopId: data.routeStopId, incidentType: data.incidentType, description: data.description, reportedBy: req.auth!.sub },
    });
    res.status(201).json(incident);
  })
);
