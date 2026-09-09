// Parte PURA (sin acceso a base de datos) de la carga del maestro de
// clientes/socios -- separada de customer-master-import.service.ts a
// propósito, mismo criterio que excel-import-parser.ts (orders), para poder
// probar el parseo de forma aislada sin necesitar conexión a Prisma/Postgres.
//
// Por qué existe este maestro aparte del Excel de pedidos: dentro del ERP la
// dirección de entrega vive en la ficha del socio/cliente, no en la línea de
// pedido -- el informe de pedidos exportado solo trae el código de cliente,
// así que al cargarlo todos los pedidos fallaban por falta de dirección.
// Este maestro (Código, Nombre, Dirección completa) permite cargar antes las
// direcciones por código de cliente para que la carga de pedidos las
// resuelva automáticamente (ver orders-excel-import.service.ts).
import * as XLSX from "xlsx";

function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[°º]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const HEADER_ALIASES: Record<string, string> = {
  "codigo": "code",
  "codigo cliente": "code",
  "cod cliente": "code",
  "cod": "code",
  "codigo socio": "code",
  "nombre": "name",
  "cliente": "name",
  "razon social": "name",
  "nombre cliente": "name",
  "direccion completa": "addressRaw",
  "direccion": "addressRaw",
  "domicilio": "addressRaw",
  "direccion entrega": "addressRaw",
};

function cell(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

// Separa una dirección en un único campo de texto libre (tal cual la exporta
// el ERP, ej. "Calle Mayor 15, 28901 Getafe (Madrid)") en sus componentes.
// Es deliberadamente tolerante -- si no encuentra un código postal de 5
// dígitos, devuelve solo la dirección tal cual y deja el resto vacío en
// vez de fallar, para que la fila se pueda revisar a mano después en vez de
// perderse.
export interface ParsedAddress {
  address: string;
  city?: string;
  province?: string;
  postalCode?: string;
}

export function parseAddressFreeText(raw: string): ParsedAddress {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return { address: "" };

  const cpMatch = text.match(/\b(\d{5})\b/);
  if (!cpMatch || cpMatch.index == null) {
    return { address: text };
  }

  const postalCode = cpMatch[1];
  const before = text.slice(0, cpMatch.index).replace(/[,\-–]\s*$/, "").trim();
  const after = text.slice(cpMatch.index + postalCode.length).replace(/^[,\-–]\s*/, "").trim();

  // La dirección es todo lo que hay antes del CP (puede contener comas, ej.
  // "Polígono Industrial X, Calle Segunda 5"). Si no queda nada antes (el CP
  // aparece al principio del texto), se usa el texto completo como dirección
  // para no perder información.
  const address = before || text;

  let city: string | undefined;
  let province: string | undefined;

  const parenMatch = after.match(/^(.*?)\(([^)]+)\)\s*$/);
  if (parenMatch) {
    city = parenMatch[1].replace(/[,\-–]\s*$/, "").trim() || undefined;
    province = parenMatch[2].trim() || undefined;
  } else if (after) {
    const parts = after
      .split(/[,\-–]/)
      .map((s) => s.trim())
      .filter(Boolean);
    city = parts[0] || undefined;
    province = parts[1] || undefined;
  }

  return { address, city, province, postalCode };
}

export interface ParsedCustomerRow {
  code: string;
  name: string;
  addressRaw: string;
  address: string;
  city?: string;
  province?: string;
  postalCode?: string;
  rowNumber: number;
}

export interface ParseCustomersResult {
  customers: ParsedCustomerRow[];
  parseErrors: string[];
  rowsRead: number;
}

export function parseCustomersWorkbook(buffer: Buffer): ParseCustomersResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { customers: [], parseErrors: ["El archivo no contiene ninguna hoja"], rowsRead: 0 };

  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  if (rows.length === 0) return { customers: [], parseErrors: ["La hoja está vacía"], rowsRead: 0 };

  const headerRow = rows[0].map((h) => cell(h));
  const colMap = headerRow.map((h) => HEADER_ALIASES[normalizeHeader(h)] ?? null);

  const parseErrors: string[] = [];
  const customers: ParsedCustomerRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const excelRowNumber = i + 1;
    if (!row || row.every((v) => cell(v) === "")) continue; // fila vacía, se ignora sin avisar

    const record: Record<string, unknown> = {};
    colMap.forEach((field, idx) => {
      if (field) record[field] = row[idx];
    });

    const code = cell(record.code);
    if (!code) {
      parseErrors.push(`Fila ${excelRowNumber}: falta el Código, la fila se ignora`);
      continue;
    }

    const addressRaw = cell(record.addressRaw);
    const parsedAddress = parseAddressFreeText(addressRaw);

    customers.push({
      code,
      name: cell(record.name),
      addressRaw,
      address: parsedAddress.address,
      city: parsedAddress.city,
      province: parsedAddress.province,
      postalCode: parsedAddress.postalCode,
      rowNumber: excelRowNumber,
    });
  }

  return { customers, parseErrors, rowsRead: rows.length - 1 };
}

// --- Plantilla descargable ---------------------------------------------
export function buildCustomerMasterTemplate(): Buffer {
  const headers = ["Código", "Nombre", "Dirección completa"];

  const example = [
    ["CLI001", "Ejemplo Construcciones, S.L.", "Calle Mayor 15, 28901 Getafe (Madrid)"],
    ["CLI002", "Reformas Segundo Ejemplo, S.L.", "Avenida de la Industria 8, 28981 Parla, Madrid"],
  ];

  const instructions = [
    ["Cómo rellenar esta plantilla"],
    [""],
    ["Sirve para cargar (o completar) la dirección de entrega habitual de cada cliente a partir de su código, cuando el Excel de Pedidos no trae la dirección (esto pasa cuando en el ERP la dirección vive en la ficha del cliente/socio, no en la línea de pedido)."],
    [""],
    ["Código: el mismo código de cliente que se usa en el Excel de carga de Pedidos (columna \"Código Cliente\")."],
    ["Nombre: razón social del cliente. Si el código ya existe en el sistema, este campo es opcional (no se pisa el nombre ya guardado si se deja en blanco)."],
    ['Dirección completa: la dirección tal cual la exporta el ERP, en una sola columna (ej. "Calle Mayor 15, 28901 Getafe (Madrid)"). El sistema detecta automáticamente el código postal (5 dígitos) y, cuando puede, la población y la provincia.'],
    [""],
    ["Una vez cargado este maestro, la importación de Pedidos usará esta dirección por defecto para cualquier pedido de ese cliente que no traiga su propia dirección de entrega."],
    ["Si un pedido concreto SÍ trae dirección propia en su Excel, esa dirección tiene prioridad sobre la dirección por defecto del cliente."],
    ["Si el sistema no encuentra un código postal de 5 dígitos dentro de la dirección, se guarda igualmente el texto pero se marca en el resultado de la importación para revisarlo a mano."],
  ];

  const wb = XLSX.utils.book_new();
  const sheetClientes = XLSX.utils.aoa_to_sheet([headers, ...example]);
  sheetClientes["!cols"] = [{ wch: 14 }, { wch: 34 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, sheetClientes, "Clientes");

  const sheetInstrucciones = XLSX.utils.aoa_to_sheet(instructions);
  sheetInstrucciones["!cols"] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, sheetInstrucciones, "Instrucciones");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
