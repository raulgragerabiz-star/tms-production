// App Conductor (Fase 13): acceso limitado a la ruta del día del conductor autenticado.
// Nunca datos de otros conductores ni información comercial (tarifas, coste).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { requireDriverApp } from "@/middleware/scoped-auth";
import { resolveVehicleFromQrToken, bindVehicleToDriverToday } from "@/modules/vehicles/vehicle-qr.service";
import { broadcastToShipment, broadcastToWarehouse } from "@/realtime/ws.server";
import { maybeRecalculateEta } from "@/modules/routing/eta-recalc.service";

export const driverAppRouter = Router();
driverAppRouter.use(requireDriverApp);

// Fase 6: mismo helper "avisa y no rompas nada si falla" que en
// shipments.routes.ts, para las notificaciones en vivo que salen desde la
// App Conductor (llegada/entrega/cambio de estado de envío).
async function notifyShipmentChange(shipmentId: string, type: string, payload: Record<string, unknown>) {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { route: { select: { warehouseId: true } } },
    });
    broadcastToShipment(shipmentId, type, { shipmentId, ...payload });
    if (shipment?.route.warehouseId) broadcastToWarehouse(shipment.route.warehouseId, type, { shipmentId, ...payload });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[realtime] no se pudo notificar el cambio en vivo:", (err as Error)?.message ?? err);
  }
}

// Ruta diaria: paradas del día en orden, con dirección, ventana horaria y resumen del pedido.
//
// Fase 8k: petición de Raúl -- "necesita también un selector de fecha
// dentro de la app. para consultas pasadas o para gestiones como las de
// ahora, que las rutas de prueba tienen fecha del 09/09 pero al estar a
// 10/09 no figura nada en su app". Antes solo miraba SIEMPRE la fecha real
// de hoy (new Date()), así que una ruta de prueba con fecha pasada nunca
// aparecía. Ahora acepta `?date=YYYY-MM-DD` opcional (por defecto, hoy --
// ningún cliente que no mande el parámetro nota ningún cambio). También se
// añade "finished" a los estados aceptados: para una fecha pasada tiene
// sentido poder consultar una ruta ya entregada, no solo las activas.
driverAppRouter.get(
  "/today-route",
  asyncHandler(async (req, res) => {
    const driverId = req.auth!.driverId!;
    const dateParam = req.query.date as string | undefined;
    const day = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
    if (Number.isNaN(day.getTime())) throw HttpError.badRequest("Fecha no válida");
    day.setHours(0, 0, 0, 0);
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);

    const shipment = await prisma.shipment.findFirst({
      where: {
        driverId,
        status: { in: ["programmed", "loaded", "in_transit", "finished"] },
        route: { routeDate: { gte: day, lt: nextDay } },
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
                // Fase 8L: necesario para que la App Conductor pueda marcar
                // el icono "Formularios" (antes "Incidencia") como
                // completado/pendiente en la barra de acciones -- ver
                // StopDetailPage.tsx.
                incidents: true,
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

// QR de conductor + vehículo: el conductor escanea el QR físico pegado al
// vehículo (apps/driver-app/src/pages/ScanVehicleQrPage.tsx -- ya existía en
// el proyecto pero llamaba a un endpoint que nunca se había montado, mismo
// patrón que el GPS por lotes) para vincularlo cuando no tiene uno fijo
// asignado ese día. Actualiza el envío de hoy (si existe) y la jornada
// abierta (si la hay), para que ambos queden con el vehículo correcto sin
// que el conductor tenga que hacer nada más.
driverAppRouter.post(
  "/session/bind-vehicle",
  asyncHandler(async (req, res) => {
    const schema = z.object({ token: z.string().min(10) });
    const { token } = schema.parse(req.body);
    const driverId = req.auth!.driverId!;

    const vehicle = await resolveVehicleFromQrToken(token);
    await bindVehicleToDriverToday(driverId, vehicle.id);

    res.json({
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      vehicleType: vehicle.vehicleType?.name,
      carrier: vehicle.carrier?.legalName,
    });
  })
);

// Jornada (inicio/fin de turno) -- independiente de la ruta del día: el
// conductor puede fichar aunque todavía no se le haya asignado vehículo
// (queda con vehicleId nulo hasta que se vincula, por el envío del día o
// escaneando el QR de arriba). Como mucho una jornada abierta a la vez.
driverAppRouter.get(
  "/shifts/current",
  asyncHandler(async (req, res) => {
    const shift = await prisma.driverShift.findFirst({
      where: { driverId: req.auth!.driverId!, endedAt: null },
      include: { vehicle: { select: { plate: true } } },
      orderBy: { startedAt: "desc" },
    });
    res.json({ shift });
  })
);

driverAppRouter.post(
  "/shifts/start",
  asyncHandler(async (req, res) => {
    const schema = z.object({ lat: z.number().optional(), lng: z.number().optional() });
    const { lat, lng } = schema.parse(req.body);
    const driverId = req.auth!.driverId!;

    const existing = await prisma.driverShift.findFirst({ where: { driverId, endedAt: null } });
    if (existing) throw HttpError.conflict("Ya hay una jornada en curso");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayShipment = await prisma.shipment.findFirst({
      where: { driverId, route: { routeDate: { gte: today, lt: tomorrow } } },
    });

    const shift = await prisma.driverShift.create({
      data: { driverId, vehicleId: todayShipment?.vehicleId ?? null, startLat: lat, startLng: lng },
      include: { vehicle: { select: { plate: true } } },
    });
    res.status(201).json({ shift });
  })
);

driverAppRouter.post(
  "/shifts/end",
  asyncHandler(async (req, res) => {
    const schema = z.object({ lat: z.number().optional(), lng: z.number().optional() });
    const { lat, lng } = schema.parse(req.body);
    const driverId = req.auth!.driverId!;

    const existing = await prisma.driverShift.findFirst({ where: { driverId, endedAt: null } });
    if (!existing) throw HttpError.notFound("No hay ninguna jornada en curso");

    const shift = await prisma.driverShift.update({
      where: { id: existing.id },
      data: { endedAt: new Date(), endLat: lat, endLng: lng },
    });
    res.json({ shift });
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
      await notifyShipmentChange(shipment.id, "stop_status_changed", { routeStopId: stop.id, status: "arrived" });
    }
    res.json(updated);
  })
);

// Fase 8L (rediseño App Conductor): nota libre por parada, editable desde la
// barra de acciones ("Notas"). Campo nuevo (RouteStop.driverNotes,
// schema.prisma) -- el cliente de Prisma de este sandbox no puede
// regenerarse (sin red hacia el CDN de Prisma), así que se castea el `data`
// de escritura; en el entorno real, tras "prisma generate", queda tipado
// sin más, igual que ya pasó con maxRouteDurationHours en la Fase 8k.
driverAppRouter.patch(
  "/stops/:routeStopId/notes",
  asyncHandler(async (req, res) => {
    const schema = z.object({ note: z.string().max(2000) });
    const { note } = schema.parse(req.body);

    const stop = await prisma.routeStop.findFirst({
      where: { id: req.params.routeStopId, route: { shipment: { driverId: req.auth!.driverId! } } },
    });
    if (!stop) throw HttpError.notFound("Parada no encontrada");

    const updated = await prisma.routeStop.update({
      where: { id: stop.id },
      data: { driverNotes: note || null } as any,
    });
    res.json({ driverNotes: (updated as any).driverNotes ?? null });
  })
);

// Fase 8L: escáner de códigos (palet/bulto) por parada, como verificación de
// mercancía en ruta -- barra de acciones ("Escáner de códigos"). Campo nuevo
// (RouteStop.scannedCodes, JSON) con el mismo casteo defensivo que arriba.
driverAppRouter.post(
  "/stops/:routeStopId/scan",
  asyncHandler(async (req, res) => {
    const schema = z.object({ code: z.string().min(1).max(200) });
    const { code } = schema.parse(req.body);

    const stop = await prisma.routeStop.findFirst({
      where: { id: req.params.routeStopId, route: { shipment: { driverId: req.auth!.driverId! } } },
    });
    if (!stop) throw HttpError.notFound("Parada no encontrada");

    const current = Array.isArray((stop as any).scannedCodes) ? (stop as any).scannedCodes : [];
    const next = [...current, { code, scannedAt: new Date().toISOString() }];

    const updated = await prisma.routeStop.update({
      where: { id: stop.id },
      data: { scannedCodes: next } as any,
    });
    res.json({ scannedCodes: (updated as any).scannedCodes ?? [] });
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
    const shipmentForStop = await prisma.shipment.findUnique({ where: { routeId: stop.routeId } });
    if (shipmentForStop) {
      await notifyShipmentChange(shipmentForStop.id, "stop_status_changed", { routeStopId: stop.id, status: updated?.status });
    }
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
    await notifyShipmentChange(shipment.id, "shipment_status_changed", { status: updated.status });
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
    await notifyShipmentChange(shipment.id, "position_update", { lat: data.lat, lng: data.lng, occurredAt: event.occurredAt });
    // Fase 6: recálculo de ETA por desviación/intervalo -- en segundo plano
    // respecto a la respuesta del ping (no se espera aquí con `await`) para
    // que un GPS ping nunca se retrase por una llamada a la API de rutas.
    maybeRecalculateEta(shipment.id, { lat: data.lat, lng: data.lng }).catch(() => {});
    res.status(201).json(event);
  })
);

// Sincronización en tiempo real despacho<->conductor: ingesta por lotes de la
// posición GPS capturada en segundo plano por la Driver App
// (apps/driver-app/src/offline/gpsTracker.ts -- ya estaba mandando aquí desde
// antes de que este endpoint existiera, por eso la URL y forma del body están
// fijadas por ese cliente, no al revés). Los lotes pueden reintentarse tras
// perder cobertura (offlineQueue.ts), así que la inserción es idempotente por
// `clientEventId`: reintentar un lote ya guardado no duplica nada.
driverAppRouter.post(
  "/shipments/:id/tracking-events",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      pings: z
        .array(
          z.object({
            clientEventId: z.string().uuid(),
            lat: z.number(),
            lng: z.number(),
            occurredAt: z.coerce.date(),
          })
        )
        .min(1),
    });
    const { pings } = schema.parse(req.body);

    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, driverId: req.auth!.driverId! } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");

    const result = await prisma.trackingEvent.createMany({
      data: pings.map((p) => ({
        shipmentId: shipment.id,
        eventType: "gps_ping" as const,
        lat: p.lat,
        lng: p.lng,
        occurredAt: p.occurredAt,
        clientEventId: p.clientEventId,
      })),
      skipDuplicates: true,
    });

    // Se usa el ping más reciente del lote como posición "actual" para el
    // aviso en vivo y el recálculo de ETA -- los anteriores del mismo lote ya
    // quedaron guardados como histórico, pero solo el último importa para
    // saber dónde está el vehículo ahora mismo.
    const latest = [...pings].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
    await notifyShipmentChange(shipment.id, "position_update", { lat: latest.lat, lng: latest.lng, occurredAt: latest.occurredAt });
    maybeRecalculateEta(shipment.id, { lat: latest.lat, lng: latest.lng }).catch(() => {});

    res.status(201).json({ inserted: result.count, received: pings.length });
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
