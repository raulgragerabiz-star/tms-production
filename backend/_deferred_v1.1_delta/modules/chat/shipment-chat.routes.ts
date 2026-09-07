import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { requireCarrierPortal } from "../../middleware/requireCarrierPortal";
import { prisma } from "../../lib/prisma";
import { broadcastShipmentMessage } from "../../realtime/socket-server";

const router = Router();

const MessageSchema = z.object({ body: z.string().min(1).max(2000) });

/**
 * Documento 13-portal-transportista-TMS.md: "Chat: canal de mensajería por
 * ruta/envío entre planificador y transportista, con historial adjunto a
 * shipment — evita depender de canales externos (WhatsApp/email)".
 *
 * Se expone en dos prefijos con el MISMO handler, cada uno con su propio
 * guard de scope: el backoffice puede ver cualquier shipment de su
 * company; el Portal Transportista solo los suyos.
 */

router.get("/shipments/:shipmentId/messages", requireAuth, async (req, res, next) => {
  try {
    const { shipmentId } = req.params;
    const messages = await prisma.shipmentMessage.findMany({
      where: { shipmentId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return res.status(200).json({ messages });
  } catch (err) {
    next(err);
  }
});

router.post("/shipments/:shipmentId/messages", requireAuth, async (req, res, next) => {
  try {
    const { shipmentId } = req.params;
    const { body } = MessageSchema.parse(req.body);

    const message = await prisma.shipmentMessage.create({
      data: {
        shipmentId,
        senderType: "internal",
        senderId: req.auth!.userId,
        body,
      },
    });

    broadcastShipmentMessage(shipmentId, message);
    return res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

// --- Portal Transportista: mismo recurso, scope reforzado por carrierId ---

router.get("/carrier-portal/shipments/:shipmentId/messages", requireCarrierPortal, async (req, res, next) => {
  try {
    const { shipmentId } = req.params;
    const carrierId = req.auth!.carrierId!;

    const shipment = await prisma.shipment.findFirst({ where: { id: shipmentId, carrierId } });
    if (!shipment) return res.status(404).json({ error: "shipment_not_found_for_carrier" });

    const messages = await prisma.shipmentMessage.findMany({
      where: { shipmentId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return res.status(200).json({ messages });
  } catch (err) {
    next(err);
  }
});

router.post("/carrier-portal/shipments/:shipmentId/messages", requireCarrierPortal, async (req, res, next) => {
  try {
    const { shipmentId } = req.params;
    const carrierId = req.auth!.carrierId!;
    const { body } = MessageSchema.parse(req.body);

    const shipment = await prisma.shipment.findFirst({ where: { id: shipmentId, carrierId } });
    if (!shipment) return res.status(404).json({ error: "shipment_not_found_for_carrier" });

    const message = await prisma.shipmentMessage.create({
      data: {
        shipmentId,
        senderType: "carrier_portal",
        senderId: req.auth!.userId,
        body,
      },
    });

    broadcastShipmentMessage(shipmentId, message);
    return res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

export default router;
