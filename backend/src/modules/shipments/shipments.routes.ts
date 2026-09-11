import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { broadcastToWarehouse, broadcastToShipment } from "@/realtime/ws.server";

export const shipmentsRouter = Router();

// Fase 6: aviso en vivo (WebSocket) a quien esté viendo el despacho de este
// almacén y a quien esté viendo este envío en concreto. Envuelto en
// try/catch en cada punto de uso -- un fallo notificando en vivo nunca debe
// impedir que la operación real (cambiar un estado, registrar una entrega)
// se complete y responda con éxito; en el peor caso, esa pantalla se entera
// en el siguiente sondeo en vez de al instante.
async function notifyShipmentChange(shipmentId: string, type: string, payload: Record<string, unknown>) {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { route: { select: { warehouseId: true } } },
    });
    broadcastToShipment(shipmentId, type, { shipmentId, ...payload });
    if (shipment?.route.warehouseId) {
      broadcastToWarehouse(shipment.route.warehouseId, type, { shipmentId, ...payload });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[realtime] no se pudo notificar el cambio en vivo:", (err as Error)?.message ?? err);
  }
}

shipmentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const items = await prisma.shipment.findMany({
      where: { route: { companyId: req.auth!.companyId }, ...(status ? { status: status as any } : {}) },
      include: {
        route: {
          include: {
            // Fase 8O -- fix: Seguimiento no pintaba nada en el mapa salvo
            // que ya hubiera llegado al menos un ping GPS del conductor --
            // en ese hueco (sobre todo nada más salir a reparto) el mapa se
            // veía completamente vacío. Se añaden las coordenadas del
            // almacén y de cada punto de entrega (ya existían en el modelo,
            // solo faltaba pedirlas aquí) para poder dibujar de respaldo el
            // recorrido planificado mientras no hay posición en vivo.
            warehouse: { select: { name: true, lat: true, lng: true } },
            stops: {
              orderBy: { sequence: "asc" },
              include: {
                order: {
                  select: {
                    orderNumber: true,
                    customer: { select: { legalName: true } },
                    deliveryPoint: { select: { address: true, city: true, lat: true, lng: true } },
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
    await notifyShipmentChange(shipment.id, "shipment_status_changed", { status: updated.status });
    res.json(updated);
  })
);

// Fase 6: histórico de posiciones GPS de un envío como línea (para "repetir"
// visualmente el recorrido en el mapa) -- usa PostGIS cuando está disponible
// (columna `geom` sobre tracking_event, ver prisma/postgis-setup.sql) para
// simplificar la línea a un número razonable de puntos con ST_Simplify; si
// PostGIS todavía no está instalado en esta base de datos, o la consulta
// falla por cualquier motivo, cae a devolver los puntos en bruto (lat/lng de
// TrackingEvent, que siempre ha existido) sin simplificar -- el mapa sigue
// funcionando igual, solo que con más puntos.
shipmentsRouter.get(
  "/:id/track",
  asyncHandler(async (req, res) => {
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, route: { companyId: req.auth!.companyId } } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");

    try {
      const rows = await prisma.$queryRaw<{ geojson: string }[]>`
        SELECT ST_AsGeoJSON(ST_Simplify(ST_MakeLine(geom ORDER BY occurred_at), 0.0001)) AS geojson
        FROM tracking_event
        WHERE shipment_id = ${shipment.id}::uuid AND geom IS NOT NULL
      `;
      const geojson = rows[0]?.geojson ? JSON.parse(rows[0].geojson) : null;
      if (geojson?.coordinates?.length) {
        return res.json({
          source: "postgis",
          points: geojson.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng })),
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[track] PostGIS no disponible o consulta fallida, se devuelven puntos sin simplificar:", (err as Error)?.message ?? err);
    }

    const events = await prisma.trackingEvent.findMany({
      where: { shipmentId: shipment.id, lat: { not: null }, lng: { not: null } },
      orderBy: { occurredAt: "asc" },
      select: { lat: true, lng: true, occurredAt: true },
    });
    res.json({ source: "raw", points: events.map((e) => ({ lat: e.lat, lng: e.lng, occurredAt: e.occurredAt })) });
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
    const shipmentForStop = await prisma.shipment.findUnique({ where: { routeId: stop.routeId } });
    if (shipmentForStop) {
      await notifyShipmentChange(shipmentForStop.id, "stop_status_changed", {
        routeStopId: stop.id,
        status: stopUpdated?.status,
      });
    }
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
    if (data.lat != null && data.lng != null) {
      await notifyShipmentChange(shipment.id, "position_update", { lat: data.lat, lng: data.lng, occurredAt: event.occurredAt });
    }
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
