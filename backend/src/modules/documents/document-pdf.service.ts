// Fase 8Q2: documentación legal real asociada a los pedidos -- petición
// explícita de Raúl ("albarán de producto y control de mercancía por
// carretera en modo virtual para estar legalmente documentado"), tercer
// punto que había quedado aplazado del backlog de "Ficha única del pedido".
//
// Genera dos documentos, replicando el formato de los documentos reales de
// BigMat Logística que aportó Raúl como plantilla (cabecera empresa/tienda +
// QR arriba a la derecha, bloque cliente/destinatario, tabla de líneas, pie
// con el texto de Registro Mercantil):
//
//   - ALBARÁN DE ENTREGA (`DocumentType.delivery_note`): documento interno
//     del TMS que certifica QUÉ se entregó y CUÁNDO -- sin precios/importes
//     a propósito, porque este TMS no modela precios de venta (eso lo sigue
//     emitiendo el ERP en su propio albarán/factura oficial, como el PDF de
//     ejemplo aportado); este es un albarán DE ENTREGA/TRANSPORTE, con el
//     justificante de entrega (firma, quién recibió, fecha) cuando ya existe.
//   - CARTA DE PORTE (`DocumentType.carriage_note`): documento de control de
//     mercancía por carretera, con los datos que exige un control de
//     carretera (remitente, transportista, vehículo, conductor,
//     destinatario(s), mercancía, fechas) -- equivalente español al CMR.
//
// Aviso importante (no legal): esto genera un documento con los campos
// habituales de un albarán/carta de porte para tener la operativa
// documentada digitalmente y poder enseñarlo en un control de carretera vía
// QR: no es una presentación a ningún registro oficial ni sustituye el
// asesoramiento de un gestor de transporte sobre requisitos específicos
// (ADR, transporte internacional, etc.).
//
// Librería `pdfkit` (dibuja el PDF a mano, sin motor de plantillas HTML->PDF
// -- ya se usa este criterio de "sin dependencia pesada" en el resto del
// proyecto) + `qrcode` para el código QR de verificación. Ambas puras JS,
// sin binarios nativos que compilar en el build de Docker.
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import { env } from "@/config/env";

const PAGE_MARGIN = 40;

// Token de verificación embebido en el QR -- mismo mecanismo que el resto de
// la app usa para sesión (jsonwebtoken, ya dependencia del proyecto), pero
// sin expiración: un albarán/carta de porte ya emitidos deben poder seguir
// verificándose más adelante (auditoría, control de carretera fuera de
// plazo), igual que el papel no "caduca". Payload mínimo, sin datos
// personales -- solo el tipo de documento y el id del registro al que
// corresponde; los datos reales siempre se leen de la base de datos en el
// momento de verificar, nunca del propio token.
interface DocumentTokenPayload {
  typ: "delivery_note" | "carriage_note";
  id: string;
}

export function signDocumentToken(payload: DocumentTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret);
}

export function verifyDocumentToken(token: string): DocumentTokenPayload {
  return jwt.verify(token, env.jwtSecret) as DocumentTokenPayload;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-ES");
}

function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.toLocaleDateString("es-ES")} ${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
}

function formatAddressLine(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(", ");
}

interface CompanyProfile {
  name: string;
  taxId: string;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  phone?: string | null;
  email?: string | null;
  mercantileRegistryText?: string | null;
}

function drainToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function drawFooter(doc: PDFKit.PDFDocument, company: CompanyProfile, docLabel: string) {
  const bottom = doc.page.height - 30;
  doc
    .fontSize(7)
    .fillColor("#64748b")
    .text(
      company.mercantileRegistryText || "",
      PAGE_MARGIN,
      bottom,
      { width: doc.page.width - PAGE_MARGIN * 2 - 140, lineBreak: false }
    );
  doc.text(docLabel, doc.page.width - PAGE_MARGIN - 140, bottom, { width: 140, align: "right", lineBreak: false });
  doc.fillColor("#000000");
}

function drawHeaderBlock(
  doc: PDFKit.PDFDocument,
  titleLines: { label: string; value: string }[],
  qrPng: Buffer
) {
  let y = PAGE_MARGIN;
  titleLines.forEach((line, idx) => {
    const x = PAGE_MARGIN + idx * 170;
    doc.fontSize(8).fillColor("#64748b").text(line.label, x, y);
    doc.fontSize(10).fillColor("#0f172a").font("Helvetica-Bold").text(line.value, x, y + 11);
    doc.font("Helvetica");
  });
  doc.image(qrPng, doc.page.width - PAGE_MARGIN - 70, y - 4, { width: 70, height: 70 });
  doc.fillColor("#000000");
  return y + 90;
}

function drawCompanyBlock(doc: PDFKit.PDFDocument, x: number, y: number, width: number, company: CompanyProfile, extraLines: string[] = []) {
  doc.fontSize(10).font("Helvetica-Bold").text(company.name, x, y, { width });
  doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
  let cy = y + 13;
  if (company.address) {
    doc.text(company.address, x, cy, { width });
    cy += 11;
  }
  const cityLine = formatAddressLine([company.postalCode, company.city, company.province]);
  if (cityLine) {
    doc.text(cityLine, x, cy, { width });
    cy += 11;
  }
  const contactLine = formatAddressLine([company.phone, company.email]);
  if (contactLine) {
    doc.text(contactLine, x, cy, { width });
    cy += 11;
  }
  for (const line of extraLines) {
    doc.text(line, x, cy, { width });
    cy += 11;
  }
  doc.fillColor("#000000");
  return cy;
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number, columns: { label: string; x: number; width: number; align?: "left" | "right" }[]) {
  doc.fontSize(8).font("Helvetica-Bold").fillColor("#64748b");
  for (const col of columns) {
    doc.text(col.label, col.x, y, { width: col.width, align: col.align ?? "left" });
  }
  doc.font("Helvetica").fillColor("#000000");
  doc
    .moveTo(PAGE_MARGIN, y + 13)
    .lineTo(doc.page.width - PAGE_MARGIN, y + 13)
    .strokeColor("#cbd5e1")
    .stroke();
  return y + 20;
}

// ---------------------------------------------------------------------------
// ALBARÁN DE ENTREGA
// ---------------------------------------------------------------------------

export interface DeliveryNoteOrder {
  orderNumber: string;
  requestedDeliveryDate: Date;
  notes: string | null;
  customer: { legalName: string; taxId: string | null };
  deliveryPoint: { label: string | null; address: string; postalCode: string | null; city: string | null; province: string | null; contactPhone: string | null };
  warehouse: { name: string; address: string | null; postalCode: string | null; city: string | null; province: string | null };
  lines: { quantity: any; unit: string; lineWeightKg: any; product: { sku: string; description: string; ean: string | null } }[];
  pod: { signatureUrl: string | null; receivedByName: string | null; deliveredAt: Date } | null;
}

export async function renderDeliveryNotePdf(order: DeliveryNoteOrder, company: CompanyProfile, verifyUrl: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true });
  const bufferPromise = drainToBuffer(doc);
  const qrPng = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 180 });

  let y = drawHeaderBlock(
    doc,
    [
      { label: "ALBARÁN DE ENTREGA", value: `ALB-${order.orderNumber}` },
      { label: "FECHA ENTREGA PREVISTA", value: formatDate(order.requestedDeliveryDate) },
      { label: "PEDIDO", value: order.orderNumber },
    ],
    qrPng
  );
  y += 10;

  const colWidth = (doc.page.width - PAGE_MARGIN * 2 - 20) / 2;
  const leftBottom = drawCompanyBlock(doc, PAGE_MARGIN, y, colWidth, company, [
    `Origen: ${order.warehouse.name}${order.warehouse.address ? ` - ${order.warehouse.address}` : ""}`,
    formatAddressLine([order.warehouse.postalCode, order.warehouse.city, order.warehouse.province]),
  ]);

  const rightX = PAGE_MARGIN + colWidth + 20;
  doc.fontSize(10).font("Helvetica-Bold").text(order.customer.legalName, rightX, y, { width: colWidth });
  doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
  let ry = y + 13;
  const deliveryAddr = order.deliveryPoint.label ? `${order.deliveryPoint.label} - ${order.deliveryPoint.address}` : order.deliveryPoint.address;
  doc.text(`Entregar en: ${deliveryAddr}`, rightX, ry, { width: colWidth });
  ry += 11;
  const dpCityLine = formatAddressLine([order.deliveryPoint.postalCode, order.deliveryPoint.city, order.deliveryPoint.province]);
  if (dpCityLine) {
    doc.text(dpCityLine, rightX, ry, { width: colWidth });
    ry += 11;
  }
  if (order.deliveryPoint.contactPhone) {
    doc.text(`Tel: ${order.deliveryPoint.contactPhone}`, rightX, ry, { width: colWidth });
    ry += 11;
  }
  doc.fillColor("#000000");

  y = Math.max(leftBottom, ry) + 20;

  const columns = [
    { label: "UDS.", x: PAGE_MARGIN, width: 55 },
    { label: "SKU / EAN", x: PAGE_MARGIN + 55, width: 100 },
    { label: "DESCRIPCIÓN", x: PAGE_MARGIN + 155, width: doc.page.width - PAGE_MARGIN * 2 - 155 - 90 },
    { label: "PESO (KG)", x: doc.page.width - PAGE_MARGIN - 90, width: 90, align: "right" as const },
  ];
  y = drawTableHeader(doc, y, columns);

  let totalWeight = 0;
  for (const line of order.lines) {
    if (y > doc.page.height - 140) {
      doc.addPage();
      y = PAGE_MARGIN;
      y = drawTableHeader(doc, y, columns);
    }
    const qty = Number(line.quantity);
    const weight = line.lineWeightKg != null ? Number(line.lineWeightKg) : null;
    if (weight != null) totalWeight += weight;
    doc.fontSize(8.5);
    doc.text(`${qty.toLocaleString("es-ES")} ${line.unit}`, columns[0].x, y, { width: columns[0].width });
    doc.text(line.product.ean || line.product.sku, columns[1].x, y, { width: columns[1].width });
    doc.text(line.product.description, columns[2].x, y, { width: columns[2].width });
    doc.text(weight != null ? weight.toLocaleString("es-ES", { maximumFractionDigits: 2 }) : "—", columns[3].x, y, {
      width: columns[3].width,
      align: "right",
    });
    y += 16;
  }

  y += 8;
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .strokeColor("#cbd5e1")
    .stroke();
  y += 8;
  doc.font("Helvetica-Bold").fontSize(9).text(`Peso total: ${totalWeight.toLocaleString("es-ES", { maximumFractionDigits: 2 })} kg`, PAGE_MARGIN, y, {
    width: doc.page.width - PAGE_MARGIN * 2,
    align: "right",
  });
  doc.font("Helvetica");
  y += 24;

  if (order.notes) {
    doc.fontSize(8.5).font("Helvetica-Bold").text("Observaciones", PAGE_MARGIN, y);
    doc.font("Helvetica").text(order.notes, PAGE_MARGIN, y + 12, { width: doc.page.width - PAGE_MARGIN * 2 });
    y += 12 + doc.heightOfString(order.notes, { width: doc.page.width - PAGE_MARGIN * 2 }) + 16;
  }

  if (order.pod) {
    doc.fontSize(8.5).font("Helvetica-Bold").text("Justificante de entrega", PAGE_MARGIN, y);
    y += 14;
    doc.font("Helvetica").fontSize(8.5);
    doc.text(`Recibido por: ${order.pod.receivedByName || "—"}`, PAGE_MARGIN, y);
    doc.text(`Fecha/hora de entrega: ${formatDateTime(order.pod.deliveredAt)}`, PAGE_MARGIN, y, { width: doc.page.width - PAGE_MARGIN * 2, align: "right" });
    y += 14;
    if (order.pod.signatureUrl && order.pod.signatureUrl.startsWith("data:image")) {
      try {
        const base64 = order.pod.signatureUrl.split(",")[1];
        const buf = Buffer.from(base64, "base64");
        doc.image(buf, PAGE_MARGIN, y, { width: 160, height: 60, fit: [160, 60] });
        doc.fontSize(7).fillColor("#64748b").text("Firma de conformidad", PAGE_MARGIN, y + 62);
        doc.fillColor("#000000");
      } catch {
        // Firma no decodificable (formato inesperado) -- se omite sin romper el resto del documento.
      }
    }
  } else {
    doc.fontSize(8.5).fillColor("#94a3b8").text("Pedido pendiente de entrega -- sin justificante todavía.", PAGE_MARGIN, y);
    doc.fillColor("#000000");
  }

  doc.fontSize(7).fillColor("#94a3b8").text(
    "Documento de entrega interno generado por el TMS -- sin valor fiscal, no sustituye al albarán/factura oficial del ERP.",
    PAGE_MARGIN,
    doc.page.height - 55,
    { width: doc.page.width - PAGE_MARGIN * 2 }
  );
  doc.fillColor("#000000");
  drawFooter(doc, company, `ALB-${order.orderNumber}`);

  doc.end();
  return bufferPromise;
}

// ---------------------------------------------------------------------------
// CARTA DE PORTE (control de mercancía por carretera)
// ---------------------------------------------------------------------------

export interface CarriageNoteRoute {
  id: string;
  routeDate: Date;
  warehouse: { name: string; address: string | null; postalCode: string | null; city: string | null; province: string | null };
  carrier: { legalName: string; taxId: string } | null;
  vehicle: { plate: string; trailerPlate: string | null } | null;
  driver: { fullName: string; taxId: string } | null;
  costSimulations: { estimatedCost: any }[];
  stops: {
    order: {
      orderNumber: string;
      customer: { legalName: string; taxId: string | null };
      deliveryPoint: { address: string; postalCode: string | null; city: string | null; province: string | null };
      lines: {
        quantity: any;
        unit: string;
        lineWeightKg: any;
        product: { description: string; requiresAdr: boolean; carriageNoteDescription: string | null };
      }[];
    };
  }[];
}

export async function renderCarriageNotePdf(route: CarriageNoteRoute, company: CompanyProfile, verifyUrl: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true });
  const bufferPromise = drainToBuffer(doc);
  const qrPng = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 180 });

  const docNumber = `CP-${route.id.slice(0, 8).toUpperCase()}`;

  let y = drawHeaderBlock(
    doc,
    [
      { label: "CARTA DE PORTE", value: docNumber },
      { label: "FECHA DE EXPEDICIÓN", value: formatDate(route.routeDate) },
      { label: "REF. RUTA", value: route.id.slice(0, 8).toUpperCase() },
    ],
    qrPng
  );
  y += 10;

  const colWidth = (doc.page.width - PAGE_MARGIN * 2 - 20) / 2;
  const leftBottom = drawCompanyBlock(doc, PAGE_MARGIN, y, colWidth, company, [
    `Cargado en: ${route.warehouse.name}${route.warehouse.address ? ` - ${route.warehouse.address}` : ""}`,
    formatAddressLine([route.warehouse.postalCode, route.warehouse.city, route.warehouse.province]),
  ]);
  doc.fontSize(7.5).fillColor("#94a3b8").text("(Remitente / cargador)", PAGE_MARGIN, y - 10);
  doc.fillColor("#000000");

  const rightX = PAGE_MARGIN + colWidth + 20;
  doc.fontSize(7.5).fillColor("#94a3b8").text("(Transportista)", rightX, y - 10);
  doc.fillColor("#000000");
  doc.fontSize(10).font("Helvetica-Bold").text(route.carrier?.legalName || "Sin transportista asignado", rightX, y, { width: colWidth });
  doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
  let ry = y + 13;
  if (route.carrier) {
    doc.text(`CIF/NIF: ${route.carrier.taxId}`, rightX, ry, { width: colWidth });
    ry += 11;
  }
  doc.text(`Vehículo: ${route.vehicle ? route.vehicle.plate + (route.vehicle.trailerPlate ? ` / remolque ${route.vehicle.trailerPlate}` : "") : "—"}`, rightX, ry, {
    width: colWidth,
  });
  ry += 11;
  doc.text(`Conductor: ${route.driver ? `${route.driver.fullName} (${route.driver.taxId})` : "—"}`, rightX, ry, { width: colWidth });
  ry += 11;
  doc.fillColor("#000000");

  y = Math.max(leftBottom, ry) + 20;

  doc.fontSize(8.5).font("Helvetica-Bold").text("Destinatarios y mercancía", PAGE_MARGIN, y);
  y += 16;

  const columns = [
    { label: "PEDIDO / DESTINATARIO", x: PAGE_MARGIN, width: 190 },
    { label: "DIRECCIÓN DE ENTREGA", x: PAGE_MARGIN + 190, width: 190 },
    { label: "MERCANCÍA", x: PAGE_MARGIN + 380, width: doc.page.width - PAGE_MARGIN * 2 - 380 - 70 },
    { label: "PESO (KG)", x: doc.page.width - PAGE_MARGIN - 70, width: 70, align: "right" as const },
  ];
  y = drawTableHeader(doc, y, columns);

  let totalWeight = 0;
  let anyAdr = false;
  for (const stop of route.stops) {
    if (y > doc.page.height - 140) {
      doc.addPage();
      y = PAGE_MARGIN;
      y = drawTableHeader(doc, y, columns);
    }
    const order = stop.order;
    const stopWeight = order.lines.reduce((sum, l) => sum + (l.lineWeightKg != null ? Number(l.lineWeightKg) : 0), 0);
    totalWeight += stopWeight;
    // `carriageNoteDescription` -- ya existía en Product (aceptado desde su
    // creación/edición) pero sin ningún consumidor hasta ahora: descripción
    // GENÉRICA de la mercancía pensada para un documento de transporte (p.ej.
    // "material de construcción" en vez de la descripción comercial completa
    // del SKU) -- se usa aquí con la descripción comercial como reserva si no
    // se ha rellenado.
    const goodsDescription = order.lines
      .map((l) => l.product.carriageNoteDescription || l.product.description)
      .join(", ");
    const stopHasAdr = order.lines.some((l) => l.product.requiresAdr);
    if (stopHasAdr) anyAdr = true;

    doc.fontSize(8.5);
    doc.text(`${order.orderNumber}\n${order.customer.legalName}`, columns[0].x, y, { width: columns[0].width });
    const dpLine = `${order.deliveryPoint.address}\n${formatAddressLine([order.deliveryPoint.postalCode, order.deliveryPoint.city, order.deliveryPoint.province])}`;
    doc.text(dpLine, columns[1].x, y, { width: columns[1].width });
    doc.text(goodsDescription + (stopHasAdr ? "  [ADR]" : ""), columns[2].x, y, { width: columns[2].width });
    doc.text(stopWeight.toLocaleString("es-ES", { maximumFractionDigits: 2 }), columns[3].x, y, { width: columns[3].width, align: "right" });
    y += 30;
  }

  y += 6;
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .strokeColor("#cbd5e1")
    .stroke();
  y += 8;
  doc.font("Helvetica-Bold").fontSize(9).text(`Peso total de la expedición: ${totalWeight.toLocaleString("es-ES", { maximumFractionDigits: 2 })} kg`, PAGE_MARGIN, y, {
    width: doc.page.width - PAGE_MARGIN * 2,
    align: "right",
  });
  doc.font("Helvetica");
  y += 20;

  if (anyAdr) {
    doc.fontSize(8.5).fillColor("#b91c1c").font("Helvetica-Bold").text("⚠ Esta expedición incluye mercancía peligrosa (ADR).", PAGE_MARGIN, y);
    doc.font("Helvetica").fillColor("#000000");
    y += 16;
  }

  const selectedCost = route.costSimulations[0]?.estimatedCost;
  if (selectedCost != null) {
    doc.fontSize(8.5).text(`Precio del transporte: ${Number(selectedCost).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`, PAGE_MARGIN, y);
    y += 14;
  }

  y += 6;
  doc.fontSize(7.5).fillColor("#94a3b8").text(
    "Documento de control de mercancía por carretera generado digitalmente por el TMS, con los datos del transporte " +
      "(remitente, transportista, vehículo, conductor, mercancía y fechas). No constituye una presentación a ningún " +
      "registro oficial ni sustituye el asesoramiento de un gestor de transporte sobre los requisitos específicos " +
      "aplicables (ADR, transporte internacional u otros).",
    PAGE_MARGIN,
    doc.page.height - 70,
    { width: doc.page.width - PAGE_MARGIN * 2 }
  );
  doc.fillColor("#000000");
  drawFooter(doc, company, docNumber);

  doc.end();
  return bufferPromise;
}
