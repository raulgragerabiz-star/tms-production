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
//   - DeCA (`DocumentType.carriage_note` -- mismo identificador interno de
//     siempre, solo cambia el documento generado): documento de control
//     administrativo del transporte por carretera. Sustituido por completo
//     en la Fase 8X (petición explícita de Raúl, con plantilla visual real
//     aportada): mismo documento de siempre (uno por ruta/envío, con todas
//     sus paradas), mismos accesos (Planificador → Gestionar ruta, App
//     Conductor, QR de verificación pública) -- cambia el diseño, la
//     estructura de datos y el nombre visible, de "Carta de porte" a "DeCA",
//     con referencia a la Orden FOM/2861/2012 y la Ley 15/2009 (LCTTM).
//
// Aviso importante (no legal): esto genera un documento con los campos
// habituales de un albarán/DeCA para tener la operativa documentada
// digitalmente y poder enseñarlo en un control de carretera vía QR: no es
// una presentación a ningún registro oficial ni sustituye el asesoramiento
// de un gestor de transporte sobre requisitos específicos (ADR, transporte
// internacional, etc.).
//
// Librería `pdfkit` (dibuja el PDF a mano, sin motor de plantillas HTML->PDF
// -- ya se usa este criterio de "sin dependencia pesada" en el resto del
// proyecto) + `qrcode` para el código QR de verificación. Ambas puras JS,
// sin binarios nativos que compilar en el build de Docker.
//
// Fase 8Z: `pdf-lib` añadida SOLO para el DeCA (`renderCarriageNotePdf`) --
// corrección de Raúl sobre el diseño de la Fase 8Y del bloque "Transportista
// efectivo": ya no es un dato que rellena Backoffice y que el PDF se limita a
// imprimir, sino un CAMPO DE FORMULARIO real dentro del propio PDF (AcroForm),
// para que la empresa subcontratada pueda escribir sus datos directamente en
// el documento con cualquier lector de PDF, sin tocar nuestro sistema.
// pdfkit no tiene soporte de formularios interactivos, así que el documento
// se sigue dibujando entero con pdfkit como siempre y, ya con los bytes
// finales, se le añade el campo de formulario con pdf-lib antes de
// devolverlo -- pdf-lib es igualmente pura JS, sin binarios nativos.
import PDFDocument from "pdfkit";
import { PDFDocument as PdfLibDocument } from "pdf-lib";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import { env } from "@/config/env";
import { BIGMAT_LOGO_PNG_BASE64 } from "./bigmat-logo-base64";

const BIGMAT_LOGO_PNG = Buffer.from(BIGMAT_LOGO_PNG_BASE64, "base64");

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
  // Fase 8Z (bug preexistente, no introducido por este cambio): pdfkit
  // comprueba, ANTES de dibujar cada línea, si "document.y + lineHeight"
  // supera `page.maxY()` (= height - PAGE_MARGIN) -- y si lo supera, añade
  // página(s) nuevas automáticamente, aunque se le pase una coordenada y
  // explícita y aunque el texto esté vacío ("" no evita la comprobación).
  // Con "height - 30" ese margen de seguridad no llegaba ni para una línea
  // (30 < PAGE_MARGIN=40 + lineHeight), así que cada DeCA/albarán generaba 2
  // páginas de más al final (una en blanco, otra solo con el número de
  // documento). Se corrige fijando el pie claramente DENTRO del margen
  // inferior, con hueco de sobra para la altura de línea a fontSize 7.
  doc.fontSize(7);
  const bottom = doc.page.maxY() - doc.currentLineHeight(true) - 4;
  doc
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
  return y + 17;
}

// ---------------------------------------------------------------------------
// Fase 8X: tarjetas con borde redondeado del DeCA (plantilla visual aportada
// por Raúl) -- una caja por dato/bloque, con etiqueta en mayúsculas arriba y
// una o varias líneas de contenido debajo. `measureInfoBoxHeight` calcula de
// antemano el alto que ocupará el contenido (para que dos cajas de la misma
// fila compartan el mismo alto, aunque una tenga más líneas que la otra) sin
// llegar a dibujar nada -- `drawInfoBox` es la que dibuja de verdad.
// ---------------------------------------------------------------------------

interface InfoBoxLine {
  text: string;
  bold?: boolean;
  size?: number;
  color?: string;
}

const INFO_BOX_PAD = 8;

function measureInfoBoxHeight(doc: PDFKit.PDFDocument, width: number, lines: InfoBoxLine[]): number {
  const innerWidth = width - INFO_BOX_PAD * 2;
  let h = INFO_BOX_PAD + 11; // etiqueta
  for (const line of lines) {
    doc.font(line.bold ? "Helvetica-Bold" : "Helvetica").fontSize(line.size ?? 9);
    h += doc.heightOfString(line.text, { width: innerWidth }) + 2;
  }
  doc.font("Helvetica");
  return h + INFO_BOX_PAD;
}

function drawInfoBox(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number, label: string, lines: InfoBoxLine[]) {
  doc.roundedRect(x, y, width, height, 6).lineWidth(1).strokeColor("#e2e8f0").stroke();
  const innerWidth = width - INFO_BOX_PAD * 2;
  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor("#64748b")
    .text(label.toUpperCase(), x + INFO_BOX_PAD, y + INFO_BOX_PAD, { width: innerWidth, characterSpacing: 0.3 });
  let cy = y + INFO_BOX_PAD + 11;
  for (const line of lines) {
    doc
      .font(line.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(line.size ?? 9)
      .fillColor(line.color ?? "#0f172a")
      .text(line.text, x + INFO_BOX_PAD, cy, { width: innerWidth });
    cy += doc.heightOfString(line.text, { width: innerWidth }) + 2;
  }
  doc.font("Helvetica").fillColor("#000000");
}

// Fase 8Z: dibuja solo el marco + etiqueta de una caja, SIN contenido -- para
// la caja de "Transportista efectivo", cuyo contenido ya no lo escribe pdfkit
// sino un campo de formulario de pdf-lib superpuesto encima (ver más abajo).
// Devuelve el rectángulo real dibujado (en el sistema de coordenadas de
// pdfkit, y con origen arriba a la izquierda) para poder calcular después el
// rectángulo del campo de formulario en coordenadas PDF reales (origen abajo
// a la izquierda).
function drawFillableInfoBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string
): { x: number; y: number; width: number; height: number } {
  doc.roundedRect(x, y, width, height, 6).lineWidth(1).strokeColor("#e2e8f0").stroke();
  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor("#64748b")
    .text(label.toUpperCase(), x + INFO_BOX_PAD, y + INFO_BOX_PAD, { width: width - INFO_BOX_PAD * 2, characterSpacing: 0.3 });
  doc.font("Helvetica").fillColor("#000000");
  return { x, y, width, height };
}

// Fase 8Z-fix: casilla pequeña individual (etiqueta diminuta + recuadro),
// usada para desglosar "Transportista efectivo" en varios campos sueltos --
// razón social, CIF, dirección, matrícula tractora, matrícula remolque --
// en vez de un único cajón de texto libre (petición de Raúl tras ver el
// primer diseño: "deberia contener casillas con razon social, direccion,
// cif, tractora, remolque y rellenar cada una de ellas"). Devuelve el
// rectángulo REAL del campo de formulario (ya con su propio margen interior
// respecto al borde dibujado, y dejando hueco para la etiqueta), en
// coordenadas pdfkit -- listo para convertir a coordenadas PDF reales.
function drawFillableField(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string
): { x: number; y: number; width: number; height: number } {
  doc.roundedRect(x, y, width, height, 4).lineWidth(1).strokeColor("#e2e8f0").stroke();
  doc
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .fillColor("#94a3b8")
    .text(label.toUpperCase(), x + 6, y + 4, { width: width - 12, characterSpacing: 0.2 });
  doc.font("Helvetica").fillColor("#000000");
  const labelHeight = 9;
  const fieldPad = 3;
  return {
    x: x + fieldPad,
    y: y + labelHeight + fieldPad,
    width: width - fieldPad * 2,
    height: height - labelHeight - fieldPad * 2,
  };
}

// Dibuja una fila de 2 cajas de igual alto (el mayor de las dos), devolviendo
// la coordenada Y justo debajo de la fila (con el hueco ya incluido).
function drawInfoBoxRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  colWidth: number,
  gap: number,
  left: { label: string; lines: InfoBoxLine[] },
  right: { label: string; lines: InfoBoxLine[] } | null
): number {
  const leftHeight = measureInfoBoxHeight(doc, colWidth, left.lines);
  const rightHeight = right ? measureInfoBoxHeight(doc, colWidth, right.lines) : 0;
  const height = Math.max(leftHeight, rightHeight, 34);
  drawInfoBox(doc, x, y, colWidth, height, left.label, left.lines);
  if (right) {
    drawInfoBox(doc, x + colWidth + gap, y, colWidth, height, right.label, right.lines);
  }
  return y + height + 8;
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
// DeCA (documento de control administrativo del transporte)
// ---------------------------------------------------------------------------

export interface CarriageNoteRoute {
  id: string;
  routeDate: Date;
  warehouse: { name: string; address: string | null; postalCode: string | null; city: string | null; province: string | null };
  carrier: {
    legalName: string;
    taxId: string;
    address?: string | null;
    postalCode?: string | null;
    city?: string | null;
    province?: string | null;
    phone?: string | null;
  } | null;
  vehicle: { plate: string; trailerPlate: string | null } | null;
  driver: { fullName: string; taxId: string } | null;
  costSimulations: { estimatedCost: any }[];
  // Fase 8Y: apartado rellenable por ruta para cuando el transportista
  // asignado (carrier, arriba) subcontrata a otra empresa distinta para
  // ejecutar el transporte -- ver comentario en Route.subcontractedCarrier*
  // (schema.prisma). Si subcontractedCarrierName está relleno, sustituye a
  // `carrier` en el bloque "Transportista efectivo" del documento.
  subcontractedCarrierName?: string | null;
  subcontractedCarrierTaxId?: string | null;
  subcontractedCarrierAddress?: string | null;
  subcontractedCarrierPhone?: string | null;
  stops: {
    // Fase 8Z: hace falta para calcular la "carga efectiva" -- ver más abajo,
    // sección "carga a bordo a día de hoy". Ya venía en el resultado real de
    // Prisma en los 3 sitios que llaman a `renderCarriageNotePdf` (usan
    // `include`, que trae todos los escalares de RouteStop) -- solo faltaba
    // declararlo aquí en el tipo. Se tipa como `string` (no como el enum de
    // Prisma) para no acoplar este fichero al cliente generado.
    status: string;
    order: {
      orderNumber: string;
      notes?: string | null;
      customer: { legalName: string; taxId: string | null };
      deliveryPoint: { label?: string | null; address: string; postalCode: string | null; city: string | null; province: string | null };
      lines: {
        quantity: any;
        unit: string;
        lineWeightKg: any;
        product: { description: string; requiresAdr: boolean; carriageNoteDescription: string | null };
      }[];
    };
  }[];
}

// Fase 8X: sustituye por completo al diseño anterior (dibujado como bloques
// de texto sueltos) por la plantilla real que aportó Raúl -- tarjetas con
// borde redondeado agrupando cada dato ("estética, distribución de datos y
// estructura que debe tener el DeCA"). Campos que pidió explícitamente:
// naturaleza de la mercancía (con las líneas de producto, igual que antes),
// peso, origen y destino de cada parada, cargador contractual (Company) y
// transportista efectivo (Carrier, con sus datos completos -- Fase 8X añadió
// dirección/CP/teléfono al modelo).
//
// Fase 8Z: corrección de Raúl sobre el diseño de la Fase 8Y. Dos cambios:
//
// 1) El bloque que antes se llamaba "Transportista efectivo" y mostraba el
//    Carrier asignado a la ruta pasa a llamarse "Transportista contratado"
//    (siempre el mismo dato de siempre, `route.carrier`) -- se libera el
//    nombre "Transportista efectivo" para el punto 2.
// 2) Nuevo: "Transportista efectivo" es ahora un CAMPO DE FORMULARIO real
//    dentro del propio PDF (ver `drawFillableInfoBox` + el post-proceso con
//    pdf-lib al final de esta función) -- la empresa subcontratada por el
//    transportista contratado escribe sus propios datos directamente en el
//    documento, sin pasar por Backoffice. Si Backoffice ya había rellenado
//    algo en `Route.subcontractedCarrier*` (Fase 8Y, apartado que se
//    mantiene como ayuda opcional en "Gestionar ruta"), esos datos se usan
//    solo como VALOR INICIAL del campo -- el campo sigue siendo editable
//    dentro del PDF por quien lo abra, nunca de solo lectura.
export async function renderCarriageNotePdf(route: CarriageNoteRoute, company: CompanyProfile, verifyUrl: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true });
  const bufferPromise = drainToBuffer(doc);

  // Nº DECA: determinista a partir del id de la ruta y su fecha de
  // expedición -- regenerar el mismo PDF más adelante da siempre el mismo
  // número, en vez de uno aleatorio distinto cada vez. "Orden de expedición"
  // usa un slice distinto del mismo id para que ambos códigos no coincidan,
  // igual que en la plantilla real aportada (dos referencias distintas).
  const routeDateObj = typeof route.routeDate === "string" ? new Date(route.routeDate) : route.routeDate;
  const yymmdd = `${String(routeDateObj.getFullYear()).slice(2)}${String(routeDateObj.getMonth() + 1).padStart(2, "0")}${String(
    routeDateObj.getDate()
  ).padStart(2, "0")}`;
  const decaNumber = `DECA-${yymmdd}-${route.id.slice(0, 4).toUpperCase()}`;
  const expeditionNumber = `EXP-${routeDateObj.getFullYear()}-${route.id.slice(4, 12).toUpperCase()}`;

  // ---- Cabecera: logo + título + Nº DECA / fecha ----
  let y = PAGE_MARGIN;
  const logoWidth = 78;
  const logoHeight = logoWidth * (115 / 283);
  doc.image(BIGMAT_LOGO_PNG, PAGE_MARGIN, y, { width: logoWidth });

  const titleX = PAGE_MARGIN + logoWidth + 14;
  const rightColWidth = 160;
  const titleWidth = doc.page.width - PAGE_MARGIN - rightColWidth - titleX;
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor("#b91c1c")
    .text("DOCUMENTO DE CONTROL ADMINISTRATIVO DEL TRANSPORTE", titleX, y, { width: titleWidth, characterSpacing: 0.2 });
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a").text("DeCA", titleX, y + 12, { width: titleWidth });
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#64748b")
    .text("Orden FOM/2861/2012 · Ley 15/2009 (LCTTM)", titleX, y + 30, { width: titleWidth });

  const rightX = doc.page.width - PAGE_MARGIN - rightColWidth;
  doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8").text("Nº DECA", rightX, y, { width: rightColWidth, align: "right" });
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#b91c1c").text(decaNumber, rightX, y + 10, { width: rightColWidth, align: "right" });
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor("#334155")
    .text(formatDate(route.routeDate), rightX, y + 25, { width: rightColWidth, align: "right" });
  doc.fillColor("#000000").font("Helvetica");

  y = Math.max(y + Math.max(logoHeight, 40), y + 42) + 8;
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .lineWidth(1.5)
    .strokeColor("#b91c1c")
    .stroke();
  doc.lineWidth(1);
  y += 14;

  // ---- Tarjetas de datos ----
  const gap = 14;
  const colWidth = (doc.page.width - PAGE_MARGIN * 2 - gap) / 2;

  const cargadorLines: InfoBoxLine[] = [{ text: company.name, bold: true }, { text: `CIF: ${company.taxId}` }];
  if (company.address) cargadorLines.push({ text: company.address });
  const companyCityLine = formatAddressLine([company.postalCode, company.city, company.province]);
  if (companyCityLine) cargadorLines.push({ text: companyCityLine });

  // "Transportista contratado" -- siempre el Carrier asignado a la ruta en el
  // Planificador (antes se llamaba "Transportista efectivo" y era sustituido
  // por el subcontratado cuando lo había; ver comentario de la Fase 8Z arriba).
  const transportistaLines: InfoBoxLine[] = route.carrier
    ? [{ text: route.carrier.legalName, bold: true }, { text: `CIF: ${route.carrier.taxId}` }]
    : [{ text: "Sin transportista asignado todavía", color: "#94a3b8" }];
  if (route.carrier) {
    if (route.carrier.address) transportistaLines.push({ text: route.carrier.address });
    const carrierCityLine = formatAddressLine([route.carrier.postalCode, route.carrier.city, route.carrier.province]);
    if (carrierCityLine) transportistaLines.push({ text: carrierCityLine });
    if (route.carrier.phone) transportistaLines.push({ text: `Tel: ${route.carrier.phone}` });
  }

  y = drawInfoBoxRow(
    doc,
    PAGE_MARGIN,
    y,
    colWidth,
    gap,
    { label: "Cargador contractual (remitente)", lines: cargadorLines },
    { label: "Transportista contratado", lines: transportistaLines }
  );

  // Fase 8Z-fix: "Transportista efectivo" -- corrección de Raúl sobre el
  // primer diseño (un único cajón de texto libre): ahora es un grupo de 5
  // casillas independientes, cada una su PROPIO campo de formulario de
  // pdf-lib -- razón social, CIF, dirección, matrícula tractora y matrícula
  // remolque (ver el post-proceso al final de la función). Las matrículas no
  // tienen ningún dato previo en el sistema (no se gestiona vehículo para
  // transportistas subcontratados), así que salen siempre vacías, a rellenar
  // a mano por quien ejecute el transporte. Se recuerdan los rectángulos de
  // las 5 casillas (en coordenadas pdfkit) para calcular después la posición
  // real de cada campo de formulario.
  const fullWidth0 = doc.page.width - PAGE_MARGIN * 2;
  const efectivoInnerWidth = fullWidth0 - INFO_BOX_PAD * 2;
  const efectivoFieldGap = 10;
  const efectivoRowHeight = 26;
  const efectivoRowGap = 6;
  const efectivoContentTop = INFO_BOX_PAD + 11 + 6; // padding + título + hueco (mismo criterio que drawInfoBox)
  const transportistaEfectivoHeight = efectivoContentTop + efectivoRowHeight * 3 + efectivoRowGap * 2 + INFO_BOX_PAD;
  drawFillableInfoBox(
    doc,
    PAGE_MARGIN,
    y,
    fullWidth0,
    transportistaEfectivoHeight,
    "Transportista efectivo (si el transportista contratado subcontrata el transporte a otra empresa)"
  );
  const efectivoX = PAGE_MARGIN + INFO_BOX_PAD;
  const efectivoRowY1 = y + efectivoContentTop;
  const efectivoRowY2 = efectivoRowY1 + efectivoRowHeight + efectivoRowGap;
  const efectivoRowY3 = efectivoRowY2 + efectivoRowHeight + efectivoRowGap;
  const razonSocialWidth = efectivoInnerWidth * 0.62 - efectivoFieldGap / 2;
  const cifWidth = efectivoInnerWidth - razonSocialWidth - efectivoFieldGap;
  const efectivoMitad = (efectivoInnerWidth - efectivoFieldGap) / 2;

  const razonSocialField = drawFillableField(doc, efectivoX, efectivoRowY1, razonSocialWidth, efectivoRowHeight, "Razón social");
  const cifField = drawFillableField(doc, efectivoX + razonSocialWidth + efectivoFieldGap, efectivoRowY1, cifWidth, efectivoRowHeight, "CIF");
  const direccionField = drawFillableField(doc, efectivoX, efectivoRowY2, efectivoInnerWidth, efectivoRowHeight, "Dirección");
  const tractoraField = drawFillableField(doc, efectivoX, efectivoRowY3, efectivoMitad, efectivoRowHeight, "Matrícula tractora");
  const remolqueField = drawFillableField(
    doc,
    efectivoX + efectivoMitad + efectivoFieldGap,
    efectivoRowY3,
    efectivoMitad,
    efectivoRowHeight,
    "Matrícula remolque"
  );
  y += transportistaEfectivoHeight + 8;

  // Fase 8Z: "carga efectiva a día de hoy" -- petición de Raúl de que el DeCA
  // se actualice solo según se van completando entregas, en vez de mostrar
  // siempre la carga original de toda la ruta. Se excluyen del documento las
  // paradas ya `completed` (entregadas -- ya no están en el camión); el resto
  // de estados (pending/arrived/failed/returned) se consideran todavía "a
  // bordo o sin resolver" y se mantienen. Mismo documento siempre (mismo Nº
  // DECA, determinista por ruta+fecha) -- simplemente se regenera al vuelo
  // cada vez que se abre/descarga, así que siempre refleja lo que debería
  // llevar el camión EN ESTE MOMENTO, no lo que llevaba al salir.
  const pendingStops = route.stops.filter((s) => s.status !== "completed");

  const origenLines: InfoBoxLine[] = [{ text: route.warehouse.name, bold: true }];
  if (route.warehouse.address) origenLines.push({ text: route.warehouse.address });
  const warehouseCityLine = formatAddressLine([route.warehouse.postalCode, route.warehouse.city, route.warehouse.province]);
  if (warehouseCityLine) origenLines.push({ text: warehouseCityLine });

  // "incluir cada parada si contiene más de una" (petición de Raúl): con una
  // sola parada PENDIENTE se muestra su dirección completa aquí mismo, igual
  // que la plantilla real; con varias, esta tarjeta remite a la tabla de
  // detalle de más abajo (una fila por parada, con su propia dirección y
  // mercancía) en vez de intentar meter N direcciones dentro de la misma
  // tarjeta. Con cero paradas pendientes (ruta ya completada del todo), se
  // avisa de eso en vez de mostrar una tarjeta vacía.
  const destinoLines: InfoBoxLine[] =
    pendingStops.length === 0
      ? [{ text: "Todas las paradas ya entregadas", color: "#64748b" }]
      : pendingStops.length === 1
        ? (() => {
            const stop = pendingStops[0].order;
            const lines: InfoBoxLine[] = [{ text: stop.deliveryPoint.label || stop.customer.legalName, bold: true }];
            lines.push({ text: stop.deliveryPoint.address });
            const dpCityLine = formatAddressLine([stop.deliveryPoint.postalCode, stop.deliveryPoint.city, stop.deliveryPoint.province]);
            if (dpCityLine) lines.push({ text: dpCityLine });
            return lines;
          })()
        : [
            { text: `Ruta con ${pendingStops.length} paradas pendientes`, bold: true },
            { text: "Detalle de cada parada más abajo", color: "#64748b" },
          ];

  y = drawInfoBoxRow(
    doc,
    PAGE_MARGIN,
    y,
    colWidth,
    gap,
    { label: "Lugar de origen / carga", lines: origenLines },
    { label: "Lugar de destino / entrega", lines: destinoLines }
  );

  // `carriageNoteDescription` -- descripción GENÉRICA de la mercancía pensada
  // para un documento de transporte (p.ej. "material de construcción" en vez
  // de la descripción comercial completa del SKU), con la comercial como
  // reserva si no se ha rellenado -- mismo criterio ya usado desde la
  // Fase 8Q2. Se combinan las líneas de las paradas PENDIENTES (ver más
  // arriba), sin repetir texto idéntico dos veces.
  const allLines = pendingStops.flatMap((s) => s.order.lines);
  const goodsDescriptions = Array.from(
    new Set(allLines.map((l) => l.product.carriageNoteDescription || l.product.description))
  );
  const totalWeight = allLines.reduce((sum, l) => sum + (l.lineWeightKg != null ? Number(l.lineWeightKg) : 0), 0);
  const anyAdr = allLines.some((l) => l.product.requiresAdr);

  y = drawInfoBoxRow(
    doc,
    PAGE_MARGIN,
    y,
    colWidth,
    gap,
    {
      // Etiqueta corta a propósito: con el texto largo original
      // ("...pendiente de entregar") se envolvía a 2 líneas dentro de la
      // columna estrecha y se solapaba con el contenido (measureInfoBoxHeight
      // asume 1 sola línea de etiqueta) -- el resto del documento (destino,
      // tabla de detalle) ya deja claro que solo se cuenta lo pendiente.
      label: "Mercancía pendiente",
      lines:
        pendingStops.length === 0
          ? [{ text: "—", color: "#94a3b8" }]
          : [{ text: goodsDescriptions.join(", ") || "—" }, ...(anyAdr ? [{ text: "⚠ Incluye mercancía peligrosa (ADR)", color: "#b91c1c", bold: true }] : [])],
    },
    {
      label: "Peso pendiente",
      lines: [{ text: `${totalWeight.toLocaleString("es-ES", { maximumFractionDigits: 2 })} kg`, bold: true, size: 12 }],
    }
  );

  y = drawInfoBoxRow(
    doc,
    PAGE_MARGIN,
    y,
    colWidth,
    gap,
    { label: "Matrícula tractora", lines: [{ text: route.vehicle?.plate || "—", bold: true }] },
    { label: "Matrícula remolque", lines: [{ text: route.vehicle?.trailerPlate || "—", bold: true }] }
  );

  const observaciones = Array.from(new Set(route.stops.map((s) => s.order.notes).filter((n): n is string => !!n && n.trim().length > 0)));
  const fullWidth = doc.page.width - PAGE_MARGIN * 2;
  const expedicionHeight = measureInfoBoxHeight(doc, fullWidth, [{ text: expeditionNumber, bold: true }]);
  drawInfoBox(doc, PAGE_MARGIN, y, fullWidth, expedicionHeight, "Orden de expedición", [{ text: expeditionNumber, bold: true }]);
  y += expedicionHeight + 8;

  const observacionesLines: InfoBoxLine[] = observaciones.length > 0 ? observaciones.map((n) => ({ text: n })) : [{ text: "—", color: "#94a3b8" }];
  const observacionesHeight = measureInfoBoxHeight(doc, fullWidth, observacionesLines);
  drawInfoBox(doc, PAGE_MARGIN, y, fullWidth, observacionesHeight, "Observaciones", observacionesLines);
  y += observacionesHeight + 10;

  // Detalle por parada -- solo paradas PENDIENTES (ver "carga efectiva a día
  // de hoy" más arriba), para no perder el desglose de líneas de producto que
  // pedía Raúl explícitamente ("incluyendo las líneas de producto"); con una
  // sola parada pendiente es la misma dirección que ya se ve arriba, pero
  // aquí con el detalle de mercancía.
  doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#0f172a").text("Detalle de paradas y mercancía pendientes", PAGE_MARGIN, y);
  doc.fillColor("#000000");
  y += 12;

  const columns = [
    { label: "PEDIDO / DESTINATARIO", x: PAGE_MARGIN, width: 190 },
    { label: "DIRECCIÓN DE ENTREGA", x: PAGE_MARGIN + 190, width: 190 },
    { label: "MERCANCÍA", x: PAGE_MARGIN + 380, width: doc.page.width - PAGE_MARGIN * 2 - 380 - 70 },
    { label: "PESO (KG)", x: doc.page.width - PAGE_MARGIN - 70, width: 70, align: "right" as const },
  ];
  y = drawTableHeader(doc, y, columns);

  if (pendingStops.length === 0) {
    doc.fontSize(8.5).fillColor("#94a3b8").text("No quedan paradas pendientes -- mercancía totalmente entregada.", PAGE_MARGIN, y);
    doc.fillColor("#000000");
    y += 20;
  }

  for (const stop of pendingStops) {
    const order = stop.order;
    const stopWeight = order.lines.reduce((sum, l) => sum + (l.lineWeightKg != null ? Number(l.lineWeightKg) : 0), 0);
    const goodsDescription = order.lines.map((l) => l.product.carriageNoteDescription || l.product.description).join(", ");
    const stopHasAdr = order.lines.some((l) => l.product.requiresAdr);
    const goodsText = goodsDescription + (stopHasAdr ? "  [ADR]" : "");
    const pedidoText = `${order.orderNumber}\n${order.customer.legalName}`;
    const dpLine = `${order.deliveryPoint.address}\n${formatAddressLine([order.deliveryPoint.postalCode, order.deliveryPoint.city, order.deliveryPoint.province])}`;

    // Fase 8Z-fix: alto de fila DINÁMICO -- antes era fijo (30pt) sin
    // importar el contenido, y un pedido con muchas líneas de producto
    // distintas (la celda "MERCANCÍA", la más ancha en texto) podía envolver
    // a más de 2-3 líneas y desbordar ese hueco fijo, solapando el "Precio
    // del transporte" y el bloque de verificación/QR que venían justo
    // después -- bug real visto por Raúl (texto superpuesto e ilegible). Se
    // mide el alto real de las 4 celdas a este tamaño de letra y se usa el
    // mayor, igual que ya hace `measureInfoBoxHeight` con las tarjetas.
    doc.fontSize(8.5);
    const rowHeight =
      Math.max(
        doc.heightOfString(pedidoText, { width: columns[0].width }),
        doc.heightOfString(dpLine, { width: columns[1].width }),
        doc.heightOfString(goodsText, { width: columns[2].width }),
        11
      ) + 8;

    if (y + rowHeight > doc.page.height - 160) {
      doc.addPage();
      y = PAGE_MARGIN;
      y = drawTableHeader(doc, y, columns);
      doc.fontSize(8.5);
    }

    doc.text(pedidoText, columns[0].x, y, { width: columns[0].width });
    doc.text(dpLine, columns[1].x, y, { width: columns[1].width });
    doc.text(goodsText, columns[2].x, y, { width: columns[2].width });
    doc.text(stopWeight.toLocaleString("es-ES", { maximumFractionDigits: 2 }), columns[3].x, y, { width: columns[3].width, align: "right" });
    y += rowHeight;
  }
  y += 10;

  const selectedCost = route.costSimulations[0]?.estimatedCost;
  if (selectedCost != null) {
    doc.fontSize(8.5).text(`Precio del transporte: ${Number(selectedCost).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`, PAGE_MARGIN, y);
    y += 16;
  }

  // ---- Verificación (QR) ----
  if (y > doc.page.height - 150) {
    doc.addPage();
    y = PAGE_MARGIN;
  }
  const qrPng = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 180 });
  const qrSize = 66;
  doc.image(qrPng, PAGE_MARGIN, y, { width: qrSize, height: qrSize });
  const verifTextX = PAGE_MARGIN + qrSize + 14;
  const verifTextWidth = doc.page.width - PAGE_MARGIN * 2 - qrSize - 14;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text("Verificación del documento.", verifTextX, y + 4, { width: verifTextWidth });
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor("#334155")
    .text("Escanee el código QR para consultar y verificar este DeCA.", verifTextX, y + 18, { width: verifTextWidth });
  doc.fontSize(8).fillColor("#2563eb").text(verifyUrl, verifTextX, y + 34, { width: verifTextWidth });
  doc.fillColor("#000000");
  y += qrSize + 16;

  doc.fontSize(7.5).fillColor("#94a3b8").text(
    "Documento de control generado digitalmente por el TMS conforme a la Orden FOM/2861/2012, de 13 de diciembre, por " +
      "la que se regula el documento de control administrativo exigible para el transporte público de mercancías por " +
      "carretera, y a la Ley 15/2009 del contrato de transporte terrestre de mercancías (LCTTM). El transportista " +
      "efectivo declara disponer de la autorización de transporte en vigor. No constituye una presentación a ningún " +
      "registro oficial ni sustituye el asesoramiento de un gestor de transporte sobre requisitos específicos (ADR, " +
      "transporte internacional u otros).",
    PAGE_MARGIN,
    y,
    { width: doc.page.width - PAGE_MARGIN * 2 }
  );
  doc.fillColor("#000000");
  drawFooter(doc, company, decaNumber);

  doc.end();
  const pdfkitBytes = await bufferPromise;

  // Fase 8Z-fix: post-proceso con pdf-lib -- añade los 5 campos de formulario
  // reales de "Transportista efectivo" sobre las casillas que pdfkit dejó en
  // blanco (razón social, CIF, dirección, matrícula tractora, matrícula
  // remolque -- ver más arriba). Conversión a coordenadas PDF reales (origen
  // abajo a la izquierda, que es lo que pide pdf-lib): y_pdf = altura_página
  // - y_pdfkit - alto_casilla. Las casillas se dibujan siempre en la primera
  // página (antes de cualquier `doc.addPage()` de esta función), así que se
  // anclan a la página 0 sin más comprobación.
  //
  // `setFontSize` explícito en cada campo: bug real visto por Raúl con el
  // primer diseño (un único campo multilínea) -- sin fijar el tamaño, pdf-lib
  // deja el campo en tamaño "automático" y algunos lectores (el visor de PDF
  // de Chrome, en su caso) lo agrandan de forma desproporcionada nada más
  // escribir una palabra.
  const pdfLibDoc = await PdfLibDocument.load(pdfkitBytes);
  const page0 = pdfLibDoc.getPage(0);
  const pageHeight = page0.getHeight();
  const form = pdfLibDoc.getForm();
  const EFECTIVO_FIELD_FONT_SIZE = 9;

  function addEfectivoField(name: string, rect: { x: number; y: number; width: number; height: number }, prefill: string) {
    const field = form.createTextField(`transportista_efectivo_${name}`);
    const bottomY = pageHeight - rect.y - rect.height;
    // Orden importante: `setFontSize` necesita que el campo ya tenga un
    // "default appearance" (DA), que solo existe DESPUÉS de `addToPage`
    // (pdf-lib lanza MissingDAEntryError si se llama antes). `pdfLibDoc.save()`
    // (más abajo) regenera las appearance streams de todos los campos con el
    // tamaño y texto ya fijados, así que el PDF final ya lleva el tamaño de
    // letra correcto embebido -- no depende de que el lector lo "autocalcule".
    field.addToPage(page0, { x: rect.x, y: bottomY, width: rect.width, height: rect.height });
    field.setFontSize(EFECTIVO_FIELD_FONT_SIZE);
    field.setText(prefill);
  }

  // Valor inicial de razón social/CIF/dirección: si Backoffice ya rellenó
  // algo en "Gestionar ruta" (Route.subcontractedCarrier*, Fase 8Y), se usa
  // como borrador -- los campos siguen siendo editables dentro del PDF por
  // quien lo abra, nunca de solo lectura. Las matrículas no tienen ningún
  // dato previo en el sistema, así que siempre salen vacías.
  addEfectivoField("razon_social", razonSocialField, route.subcontractedCarrierName?.trim() || "");
  addEfectivoField("cif", cifField, route.subcontractedCarrierTaxId?.trim() || "");
  addEfectivoField("direccion", direccionField, route.subcontractedCarrierAddress?.trim() || "");
  addEfectivoField("matricula_tractora", tractoraField, "");
  addEfectivoField("matricula_remolque", remolqueField, "");

  return Buffer.from(await pdfLibDoc.save());
}
