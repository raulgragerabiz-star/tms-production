import { Router } from "express";
import { z } from "zod";
import { requireDriverApp } from "../../middleware/requireDriverApp"; // ya existente
import { resolveVehicleFromQrToken } from "./vehicle-qr.service";
import { prisma } from "../../lib/prisma";

// Este router se monta ADICIONALMENTE sobre el driver-app.routes.ts ya
// existente (no lo sustituye): app.use("/api/driver-app", driverAppRoutesV1_1)

const router = Router();

const BindVehicleSchema = z.object({ token: z.string().min(10) });

/**
 * POST /api/driver-app/session/bind-vehicle
 * Flujo: el conductor escanea el QR físico del vehículo al iniciar turno.
 * Documento v1.1 §5.1 — útil cuando el conductor no tiene vehículo fijo
 * asignado ese día.
 */
router.post("/session/bind-vehicle", requireDriverApp, async (req, res, next) => {
  try {
    const { token } = BindVehicleSchema.parse(req.body);
    const vehicle = await resolveVehicleFromQrToken(token);

    // Vincula el vehículo escaneado a la sesión del conductor para el turno
    // de hoy. Se guarda en el shipment de hoy si ya existe, o se deja en
    // sesión (req.auth) para cuando se genere el shipment del día.
    req.auth!.boundVehicleId = vehicle.id;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayShipment = await prisma.shipment.findFirst({
      where: {
        driverId: req.auth!.driverId,
        route: { routeDate: today },
      },
    });

    if (todayShipment) {
      await prisma.shipment.update({
        where: { id: todayShipment.id },
        data: { vehicleId: vehicle.id },
      });
    }

    return res.status(200).json({
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      vehicleType: vehicle.vehicleType?.name,
      carrier: vehicle.carrier?.legalName,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/driver-app/shipments/:shipmentId/confirm-load
 * Checkpoint "Carga" explícito (documento v1.1 §5.2) — hasta ahora solo
 * disparable desde backoffice/portal transportista; se expone también en
 * la app del conductor con el mismo patrón de dos toques.
 * No crea estado nuevo: transiciona Shipment.status -> loaded, estado ya
 * congelado en domain-freeze.md §2.
 */
router.post("/shipments/:shipmentId/confirm-load", requireDriverApp, async (req, res, next) => {
  try {
    const { shipmentId } = req.params;

    const shipment = await prisma.shipment.findFirst({
      where: { id: shipmentId, driverId: req.auth!.driverId },
    });
    if (!shipment) {
      return res.status(404).json({ error: "shipment_not_found_for_driver" });
    }
    if (shipment.status !== "programmed") {
      return res.status(409).json({
        error: "invalid_transition",
        detail: `No se puede confirmar carga desde el estado '${shipment.status}'`,
      });
    }

    const updated = await prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: "loaded" },
    });

    return res.status(200).json({ shipment: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
