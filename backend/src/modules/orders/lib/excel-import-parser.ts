// Parte PURA (sin acceso a base de datos) de la carga de pedidos por Excel --
// separada de orders-excel-import.service.ts a propósito, para poder probar
// el parseo de cabeceras/filas de forma aislada sin necesitar una conexión a
// Prisma/Postgres (que este entorno de desarrollo no siempre tiene).
import * as XLSX from "xlsx";
import crypto from "node:crypto";

// --- Normalización de cabeceras -------------------------------------------
// Tolerante a los nombres de columna reales que ya usa Bigmat en sus propios
// informes (ej. "Ejemplo informe Pedidos mes.xlsx": Documento, Contacto, CIF,
// SKU, Concepto, Cantidad, Medida...) más los campos de destino/planificación
// que ese informe no trae (dirección, población, ventana horaria...) y que sí
// hacen falta para poder planificar el pedido en el TMS.
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
  "n pedido": "orderNumber",
  "no pedido": "orderNumber",
  "numero pedido": "orderNumber",
  "numero de pedido": "orderNumber",
  "documento": "orderNumber",
  "pedido": "orderNumber",
  "codigo cliente": "customerCode",
  "codigo": "customerCode",
  "cliente": "customerName",
  "contacto": "customerName",
  "razon social": "customerName",
  "nombre cliente": "customerName",
  "cif": "customerTaxId",
  "nif": "customerTaxId",
  "cif nif": "customerTaxId",
  "email cliente": "customerEmail",
  "correo cliente": "customerEmail",
  "email": "customerEmail",
  "correo": "customerEmail",
  "telefono contacto": "contactPhone",
  "telefono": "contactPhone",
  "almacen": "warehouseName",
  "tienda": "warehouseName",
  "direccion de entrega": "address",
  "direccion": "address",
  "poblacion": "city",
  "ciudad": "city",
  "provincia": "province",
  "codigo postal": "postalCode",
  "cp": "postalCode",
  "fecha de entrega solicitada": "requestedDeliveryDate",
  "fecha entrega": "requestedDeliveryDate",
  "fecha promesa": "requestedDeliveryDate",
  "fecha envio": "requestedDeliveryDate",
  "fecha": "orderDate",
  "fecha pedido": "orderDate",
  "fecha creacion": "orderDate",
  "ventana horaria desde": "windowFrom",
  "hora desde": "windowFrom",
  "desde": "windowFrom",
  "ventana horaria hasta": "windowTo",
  "hora hasta": "windowTo",
  "hasta": "windowTo",
  "sku": "sku",
  "codigo articulo": "sku",
  "referencia": "sku",
  "descripcion articulo": "description",
  "concepto": "description",
  "descripcion": "description",
  "cantidad": "quantity",
  "unidad": "unit",
  "medida": "unit",
  "observaciones": "notes",
  "observaciones pedido": "notes",
  "notas": "notes",
};

function parseFlexibleDate(value: unknown): Date | undefined {
  if (value == null || value === "") return undefined;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H ?? 0, parsed.M ?? 0);
    return undefined;
  }
  const str = String(value).trim();
  // dd/mm/aaaa o dd-mm-aaaa (formato habitual de los informes de Bigmat)
  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(date.getTime())) return date;
  }
  // aaaa-mm-dd (ISO)
  const ymd = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) {
    const [, y, m, d] = ymd;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(date.getTime())) return date;
  }
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? undefined : fallback;
}

function cell(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function cellNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return isNaN(n) ? undefined : n;
}

export interface ParsedOrderLine {
  sku: string;
  description?: string;
  quantity: number;
  unit: string;
  rowNumber: number;
}

export interface ParsedOrder {
  orderNumber: string;
  customerCode?: string;
  customerName?: string;
  customerTaxId?: string;
  customerEmail?: string;
  contactPhone?: string;
  warehouseName?: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  requestedDeliveryDate?: Date;
  orderDate?: Date;
  windowFrom?: string;
  windowTo?: string;
  notes?: string;
  lines: ParsedOrderLine[];
  firstRowNumber: number;
}

export interface ParseResult {
  orders: ParsedOrder[];
  parseErrors: string[];
  rowsRead: number;
}

// Lee la primera hoja del libro, tolera cabeceras en cualquier orden y
// agrupa las filas por Nº de pedido (cada línea del pedido es una fila,
// exactamente igual que el informe de Bigmat usado de referencia).
export function parseOrdersWorkbook(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { orders: [], parseErrors: ["El archivo no contiene ninguna hoja"], rowsRead: 0 };

  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  if (rows.length === 0) return { orders: [], parseErrors: ["La hoja está vacía"], rowsRead: 0 };

  const headerRow = rows[0].map((h) => cell(h));
  const colMap = headerRow.map((h) => HEADER_ALIASES[normalizeHeader(h)] ?? null);

  const parseErrors: string[] = [];
  const groups = new Map<string, ParsedOrder>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const excelRowNumber = i + 1; // +1 porque la fila 1 es la cabecera
    if (!row || row.every((v) => cell(v) === "")) continue; // fila totalmente vacía, se ignora sin avisar

    const record: Record<string, unknown> = {};
    colMap.forEach((field, idx) => {
      if (field) record[field] = row[idx];
    });

    const orderNumber = cell(record.orderNumber);
    if (!orderNumber) {
      parseErrors.push(`Fila ${excelRowNumber}: falta el Nº de pedido, la fila se ignora`);
      continue;
    }

    let group = groups.get(orderNumber);
    if (!group) {
      group = { orderNumber, lines: [], firstRowNumber: excelRowNumber };
      groups.set(orderNumber, group);
    }

    // Campos de cabecera del pedido: se toma el primer valor no vacío que se
    // encuentre entre todas las filas del grupo (la plantilla puede traerlos
    // repetidos en cada línea, como el informe de origen, o solo en la
    // primera fila).
    const headerFields: (keyof ParsedOrder)[] = [
      "customerCode",
      "customerName",
      "customerTaxId",
      "customerEmail",
      "contactPhone",
      "warehouseName",
      "address",
      "city",
      "province",
      "postalCode",
      "windowFrom",
      "windowTo",
      "notes",
    ];
    for (const f of headerFields) {
      if (!group[f] && record[f] != null && cell(record[f]) !== "") {
        (group as any)[f] = cell(record[f]);
      }
    }
    if (!group.requestedDeliveryDate) {
      const d = parseFlexibleDate(record.requestedDeliveryDate);
      if (d) group.requestedDeliveryDate = d;
    }
    if (!group.orderDate) {
      const d = parseFlexibleDate(record.orderDate);
      if (d) group.orderDate = d;
    }

    const sku = cell(record.sku);
    const quantity = cellNumber(record.quantity);
    if (sku && quantity != null && quantity > 0) {
      group.lines.push({
        sku,
        description: cell(record.description) || undefined,
        quantity,
        unit: cell(record.unit) || "Uds",
        rowNumber: excelRowNumber,
      });
    } else if (sku && (quantity == null || quantity <= 0)) {
      parseErrors.push(`Fila ${excelRowNumber}: la línea con SKU "${sku}" tiene una cantidad no válida y se ignora`);
    }
  }

  return { orders: [...groups.values()], parseErrors, rowsRead: rows.length - 1 };
}

export function generateTempPassword(): string {
  // Alfabeto sin caracteres ambiguos (0/O, 1/l/I) -- es una contraseña que se
  // va a leer y teclear a mano al menos una vez.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function slugifyBusinessCode(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return slug || "CLIENTE";
}

// --- Plantilla descargable ---------------------------------------------
// Generada en el momento a partir de las mismas cabeceras que entiende el
// parser (nunca puede desincronizarse de lo que la importación realmente
// admite), con dos filas de ejemplo -- un pedido de una sola línea y otro de
// dos líneas, para dejar claro que el Nº de pedido se repite por cada línea.
export function buildOrdersImportTemplate(): Buffer {
  const headers = [
    "Nº Pedido",
    "Código Cliente",
    "Cliente",
    "CIF",
    "Email Cliente",
    "Teléfono Contacto",
    "Almacén",
    "Dirección de entrega",
    "Población",
    "Provincia",
    "Código Postal",
    "Fecha de entrega solicitada",
    "Ventana horaria desde",
    "Ventana horaria hasta",
    "SKU",
    "Descripción artículo",
    "Cantidad",
    "Unidad",
    "Observaciones Pedido",
  ];

  const example = [
    [
      "PRUEBA-1001",
      "CLI001",
      "Ejemplo Construcciones, S.L.",
      "B12345678",
      "pedidos@ejemplo-construcciones.es",
      "600111222",
      "Getafe BM Logística",
      "Calle Mayor 15",
      "Getafe",
      "Madrid",
      "28901",
      "15/10/2026",
      "09:00",
      "14:00",
      "5393749",
      "LAMINA IMPERMEABLE CUBIERTAS/AZOTEAS DRY80 1,5X30M",
      2,
      "Rollo",
      "Dejar en recepción de obra",
    ],
    [
      "PRUEBA-1002",
      "CLI002",
      "Reformas Segundo Ejemplo, S.L.",
      "B87654321",
      "",
      "600333444",
      "Getafe BM Logística",
      "Avenida de la Industria 8",
      "Parla",
      "Madrid",
      "28981",
      "16/10/2026",
      "",
      "",
      "5399366",
      "EMPLASTE FINO BIGMAT 15KG",
      10,
      "Saco",
      "",
    ],
    [
      "PRUEBA-1002",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "5407385",
      "CINTA 15X200M 1 CARA GALGA 300 ELECTRICIDAD",
      4,
      "Uds",
      "",
    ],
  ];

  const instructions = [
    ["Cómo rellenar esta plantilla"],
    [""],
    ['Cada fila es una LÍNEA de pedido. Si un pedido tiene varias líneas, repite el mismo "Nº Pedido" en varias filas (ver el ejemplo PRUEBA-1002).'],
    ["Los datos del pedido (cliente, dirección, fechas...) solo hace falta rellenarlos en la primera fila de cada pedido; en las siguientes basta con el SKU y la cantidad."],
    [""],
    ["Columnas obligatorias: Nº Pedido, Dirección de entrega, Población, Provincia, Código Postal, Fecha de entrega solicitada, SKU, Cantidad."],
    ['Cliente: si el "Código Cliente" ya existe en el sistema, se usa ese cliente y no hace falta repetir sus datos. Si no existe, se da de alta automáticamente con el nombre indicado en "Cliente".'],
    ["Cliente nuevo -> acceso automático: al dar de alta un cliente nuevo por esta vía, se le crea automáticamente un usuario de acceso al Portal Cliente (para ver su pedido actual y los futuros). Las credenciales (email y contraseña) se muestran una sola vez en el resultado de la importación -- apúntalas o compártelas con el cliente en ese momento. Si se pierden, se puede resetear la contraseña desde Maestros > Usuarios."],
    ["Email Cliente: si no se indica, se genera uno de acceso automáticamente (no es un email real de contacto, solo sirve para iniciar sesión). Si el cliente tiene un email real, es mejor indicarlo aquí."],
    ["Almacén: si se deja en blanco y solo hay un almacén activo, se usa ese. Si hay varios, hay que indicar el nombre de uno de ellos."],
    ["SKU: si el artículo no existe en el catálogo de Productos, se crea automáticamente con datos mínimos (para poder probar el flujo) y aparece marcado en el resultado de la importación para completarlo luego desde Maestros > Productos."],
    ["Fechas: formato día/mes/año (ej. 15/10/2026)."],
    ["Nº Pedido: debe ser único. Si ya existe un pedido con ese número, esa fila se omite (no se duplica ni se sobrescribe)."],
  ];

  const wb = XLSX.utils.book_new();
  const sheetPedidos = XLSX.utils.aoa_to_sheet([headers, ...example]);
  sheetPedidos["!cols"] = headers.map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(wb, sheetPedidos, "Pedidos");

  const sheetInstrucciones = XLSX.utils.aoa_to_sheet(instructions);
  sheetInstrucciones["!cols"] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, sheetInstrucciones, "Instrucciones");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
