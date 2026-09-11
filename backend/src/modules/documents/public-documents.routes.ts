// Verificación pública de documentos (albarán de entrega / carta de porte) --
// sin login, a propósito: es lo que abre un control de carretera al escanear
// el QR impreso en el propio documento (ver document-pdf.service.ts), igual
// que /api/tracking ya es público para la consulta de seguimiento por número
// de pedido. Aquí la "segunda credencial" que evita adivinar documentos al
// azar es el token JWT firmado con el mismo secreto de sesión (jsonwebtoken,
// ya dependencia del proyecto) -- sin él, cualquier id no sirve de nada.
import { Router } from "express";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { documentsRateLimiter } from "@/middleware/documents-rate-limit";
import { renderDeliveryNotePdf, renderCarriageNotePdf, verifyDocumentToken } from "./document-pdf.service";

export const publicDocumentsRouter = Router();
publicDocumentsRouter.use(documentsRateLimiter);

function requireValidToken(typ: "delivery_note" | "carriage_note", id: string, token: unknown) {
  if (typeof token !== "string" || !token) throw HttpError.unauthorized("Falta el token de verificación");
  let payload;
  try {
    payload = verifyDocumentToken(token);
  } catch {
    throw HttpError.unauthorized("Token de verificación no válido");
  }
  if (payload.typ !== typ || payload.id !== id) {
    throw HttpError.unauthorized("Token de verificación no válido para este documento");
  }
}

publicDocumentsRouter.get(
  "/delivery-note/:orderId",
  asyncHandler(async (req, res) => {
    requireValidToken("delivery_note", req.params.orderId, req.query.token);

    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      include: {
        customer: { select: { legalName: true, taxId: true } },
        deliveryPoint: true,
        warehouse: true,
        lines: { include: { product: { select: { sku: true, description: true, ean: true } } } },
        routeStops: { include: { pod: true }, orderBy: { id: "desc" } },
      },
    });
    if (!order) throw HttpError.notFound("Documento no encontrado");

    const company = await prisma.company.findUniqueOrThrow({ where: { id: order.companyId } });
    const pod = order.routeStops.find((s) => s.pod)?.pod ?? null;
    // El QR ya está impreso en el documento con esta misma URL -- se reutiliza
    // tal cual (no hace falta volver a firmar nada) para que el enlace de
    // verificación que ve la persona que abre el PDF sea el mismo que acaba
    // de escanear.
    const verifyUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

    const pdf = await renderDeliveryNotePdf(
      { ...order, pod: pod ? { signatureUrl: pod.signatureUrl, receivedByName: pod.receivedByName, deliveredAt: pod.deliveredAt } : null },
      company,
      verifyUrl
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="albaran-${order.orderNumber}.pdf"`);
    res.send(pdf);
  })
);

publicDocumentsRouter.get(
  "/carriage-note/:routeId",
  asyncHandler(async (req, res) => {
    requireValidToken("carriage_note", req.params.routeId, req.query.token);

    const route = await prisma.route.findUnique({
      where: { id: req.params.routeId },
      include: {
        warehouse: true,
        carrier: { select: { legalName: true, taxId: true } },
        vehicle: { select: { plate: true, trailerPlate: true } },
        costSimulations: { where: { isSelected: true }, select: { estimatedCost: true } },
        stops: {
          orderBy: { sequence: "asc" },
          include: {
            order: {
              include: {
                customer: { select: { legalName: true, taxId: true } },
                deliveryPoint: true,
                lines: { include: { product: { select: { description: true, requiresAdr: true, carriageNoteDescription: true } } } },
              },
            },
          },
        },
        shipment: { include: { driver: { select: { fullName: true, taxId: true } } } },
      },
    });
    if (!route) throw HttpError.notFound("Documento no encontrado");

    const company = await prisma.company.findUniqueOrThrow({ where: { id: route.companyId } });
    const verifyUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

    const pdf = await renderCarriageNotePdf({ ...route, driver: route.shipment?.driver ?? null }, company, verifyUrl);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="carta-porte-${route.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  })
);
