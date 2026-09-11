// Fase 8R: parte PURA (sin acceso a base de datos) de la carga del catálogo
// de productos -- mismo criterio que excel-import-parser.ts (pedidos) y
// customer-master-parser.ts (clientes): separado del servicio que sí toca
// Prisma para poder probar el parseo de forma aislada.
//
// El formato de columnas viene directamente de la plantilla REAL que usa
// Bigmat para su ficha de producto (capturas aportadas por el cliente), no
// de una plantilla inventada -- de ahí que algunas columnas se solapen en
// apariencia (p.ej. "Unidad Medida Base" y "Unidad de medida" son dos
// columnas reales distintas en su Excel, aunque en la práctica casi siempre
// coincidan) y que varias vengan como texto compuesto que hay que partir:
// "Medidas Unidad/Paquete/Palet (Fondo x Ancho x Alto cm)" trae los 3 valores
// juntos ("5x5x22,6") y "Apilabilidad (sí/no, nº capas)" trae el sí/no y el
// número de capas en la misma celda ("si, 3 capas").
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

function cell(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

// Un "CODIGO" tipo EAN/interno grande (ej. 8411975755396) puede llegar desde
// Excel como número en notación científica (5E+06) si la celda no estaba
// formateada como texto -- se normaliza a un string sin exponente siempre
// que XLSX ya lo haya leído como number.
function cellAsCode(value: unknown): string {
  if (value == null) return "";
  // String(5000000) === "5000000" (JS solo usa notación exponencial para
  // números >= 1e21), así que basta con convertir directamente: si Excel
  // mostraba "5E+06" en pantalla era solo el formato de columna, el valor
  // numérico subyacente que XLSX entrega aquí ya es el entero real.
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

// Acepta tanto "17,2" (coma decimal española) como "17.2" (punto) y tolera
// separadores de miles ("1.234,5"): si hay coma Y punto, el punto se trata
// como separador de miles y se elimina antes de convertir la coma en punto.
function parseSpanishNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  let cleaned = trimmed;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = cleaned.replace(",", ".");
  }
  cleaned = cleaned.replace(/[^\d.-]/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function parseSpanishInt(raw: string): number | undefined {
  const n = parseSpanishNumber(raw);
  return n == null ? undefined : Math.round(n);
}

export interface ParsedDims {
  depthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

// "5x5x22,6" / "26 x 17,2 x 24,2" -> Fondo x Ancho x Alto. Si la celda no
// tiene exactamente 3 partes separadas por "x", se ignora sin fallar (queda
// pendiente de rellenar a mano) en vez de rechazar toda la fila.
export function parseDimsCell(raw: string): ParsedDims {
  const parts = raw.split(/x/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 3) return {};
  const [depthCm, widthCm, heightCm] = parts.map(parseSpanishNumber);
  if (depthCm == null || widthCm == null || heightCm == null) return {};
  return { depthCm, widthCm, heightCm };
}

export interface ParsedStackability {
  stackable?: boolean;
  stackableLayers?: number;
}

// "si, 3 capas" / "no" / "sí (2 capas)" -> booleano + número de capas.
export function parseStackabilityCell(raw: string): ParsedStackability {
  const norm = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!norm.trim()) return {};
  let stackable: boolean | undefined;
  if (/^\s*si\b/.test(norm)) stackable = true;
  else if (/^\s*no\b/.test(norm)) stackable = false;
  const layersMatch = norm.match(/(\d+)\s*capa/);
  const stackableLayers = layersMatch ? parseInt(layersMatch[1], 10) : undefined;
  return { stackable, stackableLayers };
}

const HEADER_ALIASES: Record<string, string> = {
  codigo: "internalCode",
  "codigo interno": "internalCode",
  "codigo empresa": "internalCode",
  descripcion: "description",
  proveedor: "supplier",
  familia: "category",
  categoria: "category",
  "unidad medida base": "baseUnit",
  "unidad de medida base": "baseUnit",
  "unidades caja": "unitsPerBox",
  "uds caja": "unitsPerBox",
  "unidades palet": "unitsPerPallet",
  "uds palet": "unitsPerPallet",
  "codigo ean": "ean",
  ean: "ean",
  clasificacion: "abcClass",
  "clasificacion abc": "abcClass",
  "unidad de medida": "measurementUnit",
  "medidas unidad fondo x ancho x alto cm": "unitDimsRaw",
  "medidas unidad": "unitDimsRaw",
  "medidas paquete caja fondo x ancho x alto cm": "boxDimsRaw",
  "medidas paquete caja": "boxDimsRaw",
  "medidas palet fondo x ancho x alto cm": "palletDimsRaw",
  "medidas palet": "palletDimsRaw",
  "apilabilidad si no n capas": "stackabilityRaw",
  apilabilidad: "stackabilityRaw",
  "condiciones de almacenamiento": "storageConditions",
  "medida a peso": "weightUnit",
  "tipo envase": "packagingType",
  "pedido minimo b2c": "minOrderQtyB2c",
  "pedido minimo": "minOrderQtyB2c",
};

export interface ParsedProductRow {
  rowNumber: number;
  internalCode?: string;
  description?: string;
  supplier?: string;
  category?: string;
  baseUnit?: string;
  unitsPerBox?: number;
  unitsPerPallet?: number;
  ean?: string;
  abcClass?: string;
  measurementUnit?: string;
  unitDepthCm?: number;
  unitWidthCm?: number;
  unitHeightCm?: number;
  boxDepthCm?: number;
  boxWidthCm?: number;
  boxHeightCm?: number;
  palletDepthCm?: number;
  palletWidthCm?: number;
  palletHeightCm?: number;
  stackable?: boolean;
  stackableLayers?: number;
  storageConditions?: string;
  weightUnit?: string;
  packagingType?: string;
  minOrderQtyB2c?: number;
}

export interface ParseProductsResult {
  products: ParsedProductRow[];
  parseErrors: string[];
  rowsRead: number;
}

export function parseProductsWorkbook(buffer: Buffer): ParseProductsResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { products: [], parseErrors: ["El archivo no contiene ninguna hoja"], rowsRead: 0 };

  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  if (rows.length === 0) return { products: [], parseErrors: ["La hoja está vacía"], rowsRead: 0 };

  const headerRow = rows[0].map((h) => cell(h));
  const colMap = headerRow.map((h) => HEADER_ALIASES[normalizeHeader(h)] ?? null);

  const parseErrors: string[] = [];
  const products: ParsedProductRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const excelRowNumber = i + 1;
    if (!row || row.every((v) => cell(v) === "")) continue; // fila vacía, se ignora sin avisar

    const record: Record<string, unknown> = {};
    colMap.forEach((field, idx) => {
      if (field) record[field] = row[idx];
    });

    const internalCode = cellAsCode(record.internalCode);
    const description = cell(record.description);
    const ean = cellAsCode(record.ean);

    if (!internalCode && !ean) {
      parseErrors.push(`Fila ${excelRowNumber}: falta CODIGO y también Código EAN, no hay forma de identificar el producto -- la fila se ignora`);
      continue;
    }
    if (!description) {
      parseErrors.push(`Fila ${excelRowNumber}: falta la DESCRIPCION, la fila se ignora`);
      continue;
    }

    const unitDims = parseDimsCell(cell(record.unitDimsRaw));
    const boxDims = parseDimsCell(cell(record.boxDimsRaw));
    const palletDims = parseDimsCell(cell(record.palletDimsRaw));
    const stackability = parseStackabilityCell(cell(record.stackabilityRaw));

    products.push({
      rowNumber: excelRowNumber,
      internalCode: internalCode || undefined,
      description,
      supplier: cell(record.supplier) || undefined,
      category: cell(record.category) || undefined,
      baseUnit: cell(record.baseUnit) || undefined,
      unitsPerBox: parseSpanishInt(cell(record.unitsPerBox)),
      unitsPerPallet: parseSpanishInt(cell(record.unitsPerPallet)),
      ean: ean || undefined,
      abcClass: cell(record.abcClass) || undefined,
      measurementUnit: cell(record.measurementUnit) || undefined,
      unitDepthCm: unitDims.depthCm,
      unitWidthCm: unitDims.widthCm,
      unitHeightCm: unitDims.heightCm,
      boxDepthCm: boxDims.depthCm,
      boxWidthCm: boxDims.widthCm,
      boxHeightCm: boxDims.heightCm,
      palletDepthCm: palletDims.depthCm,
      palletWidthCm: palletDims.widthCm,
      palletHeightCm: palletDims.heightCm,
      stackable: stackability.stackable,
      stackableLayers: stackability.stackableLayers,
      storageConditions: cell(record.storageConditions) || undefined,
      weightUnit: cell(record.weightUnit) || undefined,
      packagingType: cell(record.packagingType) || undefined,
      minOrderQtyB2c: parseSpanishInt(cell(record.minOrderQtyB2c)),
    });
  }

  return { products, parseErrors, rowsRead: rows.length - 1 };
}

// --- Plantilla descargable ---------------------------------------------
// Cabecera EXACTA de la plantilla real de Bigmat (misma que la de las
// capturas aportadas por el cliente), con dos filas de ejemplo reales.
export function buildProductMasterTemplate(): Buffer {
  const headers = [
    "CODIGO",
    "DESCRIPCION",
    "PROVEEDOR",
    "Familia",
    "Unidad Medida Base",
    "Unidades Caja",
    "Unidades Palet",
    "Código EAN",
    "Clasificación",
    "Unidad de medida",
    "Medidas Unidad (Fondo x Ancho x Alto cm)",
    "Medidas Paquete/caja (Fondo x Ancho x Alto cm)",
    "Medidas Palet (Fondo x Ancho x Alto cm)",
    "Apilabilidad (sí/no, nº capas)",
    "Condiciones de Almacenamiento",
    "Medida a Peso",
    "Tipo Envase",
    "Pedido mínimo B2C",
  ];

  const example = [
    [
      "5000001",
      "SILICONA STOP MOHO SECADO XPRESS",
      "AC MARCA ADHESIVES, S.A.",
      "Bigmat \\ Productos quimicos",
      "Unidad",
      15,
      945,
      "8411975755396",
      "A",
      "Unidad",
      "5x5x22,6",
      "26x17,2x24,2",
      "120x80x72,6",
      "si, 3 capas",
      "mantener en lugar fresco, protección luz solar (entre 5º y 30º)",
      "kg",
      "caja",
      1,
    ],
    [
      "5000002",
      "TOTAL TECH BLANCO CART 290ml",
      "AC MARCA ADHESIVES, S.A.",
      "Bigmat \\ Productos quimicos",
      "Unidad",
      12,
      864,
      "8411975917268",
      "B",
      "Unidad",
      "5x5x23",
      "22x17,2x24,6",
      "80x80x73,8",
      "si, 3 capas",
      "mantener en lugar fresco, protección luz solar (entre 5º y 30º)",
      "kg",
      "caja",
      1,
    ],
  ];

  const instructions = [
    ["Cómo rellenar esta plantilla"],
    [""],
    ["Cada fila es un producto del catálogo. CODIGO (código interno de Bigmat) o Código EAN son obligatorios -- con al menos uno de los dos se identifica el producto; DESCRIPCION es siempre obligatoria."],
    [""],
    ["Si vuelves a subir esta plantilla más adelante (por ejemplo para corregir datos o añadir productos nuevos), el sistema actualiza por CODIGO el producto que ya exista y crea uno nuevo si no lo encuentra -- puedes subir el mismo fichero corregido tantas veces como haga falta sin duplicar nada."],
    [""],
    ["Las columnas de medidas (\"Medidas Unidad\", \"Medidas Paquete/caja\", \"Medidas Palet\") van juntas en una sola celda con el formato Fondo x Ancho x Alto en centímetros, por ejemplo: 26x17,2x24,2"],
    ["\"Apilabilidad\" también va en una sola celda: escribe \"si, 3 capas\" o \"no\"."],
    [""],
    ["Cualquier columna que dejes en blanco queda pendiente de rellenar más adelante desde Maestros > Productos -- no bloquea la carga del resto de la fila."],
  ];

  const wb = XLSX.utils.book_new();
  const sheetProductos = XLSX.utils.aoa_to_sheet([headers, ...example]);
  sheetProductos["!cols"] = headers.map((h) => ({ wch: Math.max(14, Math.min(38, h.length + 4)) }));
  XLSX.utils.book_append_sheet(wb, sheetProductos, "Productos");

  const sheetInstrucciones = XLSX.utils.aoa_to_sheet(instructions);
  sheetInstrucciones["!cols"] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, sheetInstrucciones, "Instrucciones");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
