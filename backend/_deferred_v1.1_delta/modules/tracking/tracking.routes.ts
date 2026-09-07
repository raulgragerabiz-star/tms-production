import { Router } from "express";
import { z } from "zod";
import { requireDriverApp } from "../../middleware/requireDriverApp";
import { requireAuth } from "../../middleware/requireAuth";
import { ingestGpsBatch } from "./tracking.service";
import { prisma } from "../../lib/prisma";

const router = Router();

const GpsPingSchema = z.object({
  clientEventId: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  occurredAt: z.string().datetime(),
  routeStopId: z.string().uuid().nullable().optional(),
  eventType: z.enum(["gps_ping", "stop_arrival", "stop_departure"]).optional(),
});

const GpsBatchSchema = z.object({
  pings: z.array(GpsPingSchema).min(1).max(200), // límite razonable por lote de sync offline
});

/**
 * POST /api/driver-app/shipments/:shipmentId/tracking-events
 * Ingesta en lote — es el único endpoint que la App Conductor usa tanto en
 * modo online (lotes pequeños, cada pocos segundos) como en modo offline
 * (un lote grande al recuperar cobertura). Documento 14-app-conductor-TMS.md.
 */
router.post("/shipments/:shipmentId/tracking-events", requireDriverApp, async (req, res, next) => {
  try {
    const { shipmentId } = req.params;
    const { pings } = GpsBatchSchema.parse(req.body);

    const result = await ingestGpsBatch(shipmentId, req.auth!.driverId, pings);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tracking/live?warehouseId=...
 * Snapshot inicial para el mapa de Seguimiento (Pantalla 6) al cargar la
 * página, ANTES de que lleguen actualizaciones por socket — evita un mapa
 * vacío durante los primeros segundos.
 */
router.get("/live", requireAuth, async (req, res, next) => {
  try {
    const { warehouseId } = req.query as { warehouseId?: string };
    const companyId = req.auth!.companyId;

    const activeShipments = await prisma.shipment.findMany({
      where: {
        status: "in_transit",
        route: { companyId, ...(warehouseId ? { warehouseId } : {}) },
      },
      include: {
        carrier: { select: { legalName: true } },
        vehicle: { select: { plate: true } },
        trackingEvents: {
          where: { eventType: "gps_ping" },
          orderBy: { occurredAt: "desc" },
          take: 1,
        },
      },
    });

    const positions = activeShipments
      .filter((s) => s.trackingEvents.length > 0)
      .map((s) => ({
        shipmentId: s.id,
        vehicleId: s.vehicleId,
        plate: s.vehicle.plate,
        carrierName: s.carrier.legalName,
        lat: Number(s.trackingEvents[0].lat),
        lng: Number(s.trackingEvents[0].lng),
        occurredAt: s.trackingEvents[0].occurredAt,
      }));

    return res.status(200).json({ positions });
  } catch (err) {
    next(err);
  }
});

export default router;
