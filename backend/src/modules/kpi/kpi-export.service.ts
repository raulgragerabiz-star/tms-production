import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { KpiRow } from "./kpi.service";

/**
 * DECISIÓN DE DISEÑO (coherente con OPTIMIZATIONS.md de la pasada
 * anterior): para el PDF se usa `pdfkit` — generación programática directa,
 * sin motor de renderizado HTML — en vez de Puppeteer/Chromium headless.
 * Un backend que genera informes programados (potencialmente varios por
 * hora, ver dispatch-scheduled-reports.job.ts) lanzando un proceso
 * Chromium completo por cada PDF es exactamente el tipo de sobrecoste que
 * se acaba de auditar; `pdfkit` genera el mismo resultado tabular con una
 * fracción de la memoria y sin proceso hijo.
 */

export function exportToCsv(rows: KpiRow[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ];
  return lines.join("\n");
}

export async function exportToXlsx(rows: KpiRow[], sheetName = "KPIs"): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) {
      sheet.addRow(headers.map((h) => row[h]));
    }
    sheet.columns.forEach((col) => {
      col.width = 18;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function exportToPdf(rows: KpiRow[], title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(title, { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#64748b").text(`Generado: ${new Date().toLocaleString("es-ES")}`);
    doc.moveDown(1);

    if (rows.length === 0) {
      doc.fontSize(11).fillColor("#000").text("Sin datos para el periodo/filtros seleccionados.");
      doc.end();
      return;
    }

    const headers = Object.keys(rows[0]);
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / headers.length;
    const rowHeight = 18;
    let y = doc.y;

    doc.fontSize(9).fillColor("#000");
    headers.forEach((h, i) => {
      doc.text(h, doc.page.margins.left + i * colWidth, y, { width: colWidth, ellipsis: true });
    });
    y += rowHeight;
    doc.moveTo(doc.page.margins.left, y - 2).lineTo(doc.page.width - doc.page.margins.right, y - 2).stroke();

    for (const row of rows) {
      if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
        doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
        y = doc.page.margins.top;
      }
      headers.forEach((h, i) => {
        const value = row[h];
        const text = value == null ? "" : typeof value === "number" ? formatNumber(value) : String(value);
        doc.text(text, doc.page.margins.left + i * colWidth, y, { width: colWidth, ellipsis: true });
      });
      y += rowHeight;
    }

    doc.end();
  });
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
