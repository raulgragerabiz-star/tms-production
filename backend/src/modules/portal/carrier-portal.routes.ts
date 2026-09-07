// Portal del Transportista (Fase 12): acceso independiente, scope exclusivo por carrierId
// fijo en el token — nunca visibilidad de otros transportistas ni de datos internos ajenos
// a sus propios viajes (reforzado en backend, no solo en UI).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { requireCarrierPortal } from "@/middleware/scoped-auth";

export const carrierPortalRouter = Router();
carrierPortalRouter.use(requireCarrierPortal);

// Bandeja de "tareas pendientes": viajes por aceptar, POD por subir, incidencias abiertas.
carrierPortalRouter.get(
  "/inbox",
  asyncHandler(async (req, res) => {
    const carrierId = req.auth!.carrierId!;

    const [pendingAcceptance, openIncidents, activeShipments] = await Promise.all([
      prisma.route.findMany({
        where: { carrierId, status: "assigned" },
        include: { warehouse: { select: { name: true } }, stops: true },
      }),
      prisma.incident.findMany({
        where: { shipment: { carrierId }, status: "open" },
        include: { shipment: { select: { id: true } } },
      }),
      prisma.shipment.findMany({
        where: { carrierId, status: { in: ["programmed", "loaded", "in_transit"] } },
        include: { route: { select: { routeDate: true, warehouse: { select: { name: true } } } }, vehicle: true },
      }),
    ]);

    res.json({ pendingAcceptance, openIncidents, activeShipments });
  })
);

// Aceptar / rechazar rutas asignadas
carrierPortalRouter.post(
  "/routes/:id/accept",
  asyncHandler(async (req, res) => {
    const route = await prisma.route.findFirst({ where: { id: req.params.id, carrierId: req.auth!.carrierId! } });
    if (!route) throw HttpError.notFound("Ruta no encontrada");
    if (route.status !== "assigned") throw HttpError.conflict("Solo se puede aceptar una ruta en estado 'assigned'");

    const updated = await prisma.route.update({ where: { id: route.id }, data: { status: "confirmed" } });
    res.json(updated);
  })
);

carrierPortalRouter.post(
  "/routes/:id/reject",
  asyncHandler(async (req, res) => {
    const schema = z.object({ reason: z.string().min(1) });
    const { reason } = schema.parse(req.body);

    const route = await prisma.route.findFirst({ where: { id: req.params.id, carrierId: req.auth!.carrierId! } });
    if (!route) throw HttpError.notFound("Ruta no encontrada");
    if (route.status !== "assigned") throw HttpError.conflict("Solo se puede rechazar una ruta en estado 'assigned'");

    // Vuelve a optimized para reasignación (Fase 4, paso 5) y deja constancia del motivo.
    const updated = await prisma.route.update({
      where: { id: route.id },
      data: { status: "optimized", carrierId: null, vehicleId: null },
    });
    await prisma.auditLog.create({
      data: {
        companyId: route.companyId,
        entityName: "route",
        entityId: route.id,
        action: "update",
        newValue: { rejectedReason: reason },
      },
    });
    res.json(updated);
  })
);

// Mis viajes / historial
carrierPortalRouter.get(
  "/shipments",
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const items = await prisma.shipment.findMany({
      where: { carrierId: req.auth!.carrierId!, ...(status ? { status: status as any } : {}) },
      include: {
        route: {
          include: {
            warehouse: { select: { name: true } },
            stops: { include: { order: { include: { deliveryPoint: true, customer: true } }, pod: true } },
          },
        },
        vehicle: true,
        driver: true,
      },
      orderBy: { departedAt: "desc" },
    });
    res.json({ items, total: items.length });
  })
);

// Documentación de pedidos de sus rutas
carrierPortalRouter.get(
  "/shipments/:id/documents",
  asyncHandler(async (req, res) => {
    const shipment = await prisma.shipment.findFirst({
      where: { id: req.params.id, carrierId: req.auth!.carrierId! },
      include: { route: { include: { stops: { include: { order: { include: { documents: true } } } } } } },
    });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");
    const documents = shipment.route.stops.flatMap((s) => s.order.documents);
    res.json({ items: documents });
  })
);

// Subir POD desde el portal (vía de respaldo/gestión desde oficina)
carrierPortalRouter.post(
  "/stops/:routeStopId/pod",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      signatureUrl: z.string().optional(),
      photoUrls: z.array(z.string()).optional(),
      receivedByName: z.string().optional(),
    });
    const data = schema.parse(req.body);

    const stop = await prisma.routeStop.findFirst({
      where: { id: req.params.routeStopId, route: { carrierId: req.auth!.carrierId! } },
    });
    if (!stop) throw HttpError.notFound("Parada no encontrada");

    const pod = await prisma.proofOfDelivery.upsert({
      where: { routeStopId: stop.id },
      create: { routeStopId: stop.id, ...data, deliveredAt: new Date() },
      update: { ...data, deliveredAt: new Date() },
    });
    await prisma.routeStop.update({ where: { id: stop.id }, data: { status: "completed" } });
    res.status(201).json(pod);
  })
);

// Incidencias (reportar, propias)
carrierPortalRouter.post(
  "/shipments/:id/incidents",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      routeStopId: z.string().uuid().optional(),
      incidentType: z.enum(["delay", "damage", "refused", "access_issue", "other"]),
      description: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, carrierId: req.auth!.carrierId! } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");

    const incident = await prisma.incident.create({
      data: { shipmentId: shipment.id, ...data, reportedBy: req.auth!.sub },
    });
    res.status(201).json(incident);
  })
);

// Chat por ruta/envío
carrierPortalRouter.get(
  "/shipments/:id/messages",
  asyncHandler(async (req, res) => {
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, carrierId: req.auth!.carrierId! } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");
    const items = await prisma.shipmentMessage.findMany({ where: { shipmentId: shipment.id }, orderBy: { createdAt: "asc" } });
    res.json({ items });
  })
);

carrierPortalRouter.post(
  "/shipments/:id/messages",
  asyncHandler(async (req, res) => {
    const schema = z.object({ body: z.string().min(1) });
    const { body } = schema.parse(req.body);
    const shipment = await prisma.shipment.findFirst({ where: { id: req.params.id, carrierId: req.auth!.carrierId! } });
    if (!shipment) throw HttpError.notFound("Envío no encontrado");

    const message = await prisma.shipmentMessage.create({
      data: { shipmentId: shipment.id, senderType: "carrier_portal", senderName: req.auth!.email, body },
    });
    res.status(201).json(message);
  })
);

// Liquidaciones propias
carrierPortalRouter.get(
  "/settlements",
  asyncHandler(async (req, res) => {
    const items = await prisma.carrierSettlement.findMany({
      where: { carrierId: req.auth!.carrierId! },
      include: { lines: true },
      orderBy: { periodFrom: "desc" },
    });
    res.json({ items, total: items.length });
  })
);

carrierPortalRouter.post(
  "/settlements/:id/dispute",
  asyncHandler(async (req, res) => {
    const schema = z.object({ comment: z.string().min(1) });
    const { comment } = schema.parse(req.body);
    const settlement = await prisma.carrierSettlement.findFirst({
      where: { id: req.params.id, carrierId: req.auth!.carrierId! },
    });
    if (!settlement) throw HttpError.notFound("Liquidación no encontrada");

    const updated = await prisma.carrierSettlement.update({ where: { id: settlement.id }, data: { status: "disputed" } });
    await prisma.auditLog.create({
      data: {
        companyId: req.auth!.companyId,
        entityName: "carrier_settlement",
        entityId: settlement.id,
        action: "update",
        newValue: { disputeComment: comment },
      },
    });
    res.json(updated);
  })
);

// KPIs propios (espejo de lo que ve el gestor de flota sobre ellos)
carrierPortalRouter.get(
  "/kpis",
  asyncHandler(async (req, res) => {
    const carrierId = req.auth!.carrierId!;
    const [totalShipments, finishedShipments, incidents] = await Promise.all([
      prisma.shipment.count({ where: { carrierId } }),
      prisma.shipment.count({ where: { carrierId, status: "finished" } }),
      prisma.incident.count({ where: { shipment: { carrierId } } }),
    ]);
    res.json({ totalShipments, finishedShipments, incidents });
  })
);