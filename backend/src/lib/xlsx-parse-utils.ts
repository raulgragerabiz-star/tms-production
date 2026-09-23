// Fase 31 (2026-09-23): utilidad compartida por los 3 importadores de Excel
// (pedidos, productos, clientes) -- ver excel-import-parser.ts,
// product-master-parser.ts, customer-master-parser.ts.
//
// Por qué hacía falta: al subir el catálogo real de productos de Bigmat
// ("productos bbdd.xlsx", 3.5MB) la importación fallaba con "Network Error"
// en el navegador. La causa: la hoja declaraba un rango usado ("!ref") de
// 286.549 filas, pero los datos reales terminaban en la fila ~8.956 -- el
// resto eran restos sueltos de una edición anterior (2 celdas con un valor
// perdido cientos de miles de filas más abajo, sin ninguna fila vacía
// "visible" que lo delate al abrir el Excel). `XLSX.utils.sheet_to_json`
// construye un array con TODAS las filas del rango declarado sin importar
// si están vacías, así que este único fichero tardaba ~28 segundos y
// consumía ~1,5 GB de RAM en parsear -- de sobra para que la petición HTTP
// se cortase (o el proceso de Node se quedase sin memoria) antes de
// responder, lo que el navegador reporta como "Network Error" sin más
// detalle.
import * as XLSX from "xlsx";

/**
 * Recorta el rango usado de una hoja ANTES de convertirla a filas, cuando el
 * rango declarado es mucho más grande que los datos reales.
 *
 * Estrategia: localiza todas las celdas con un valor real, y busca la
 * primera fila poblada seguida de un hueco de más de `gapThreshold` filas
 * completamente vacías -- todo lo posterior a ese hueco se descarta como
 * resto suelto, no como una segunda tabla de datos real (una tabla real no
 * tiene un hueco de cientos de filas en medio; si lo tuviera, sería en sí
 * mismo un problema de la plantilla a corregir, no un caso de uso a
 * soportar).
 *
 * Es un no-op seguro cuando el rango ya es ajustado (la inmensa mayoría de
 * ficheros: no añade coste perceptible, solo evita el caso patológico).
 */
export function trimSheetToUsedRange(sheet: XLSX.WorkSheet, gapThreshold = 100): void {
  const ref = sheet["!ref"];
  if (!ref) return;

  const populatedRows: number[] = [];
  for (const key of Object.keys(sheet)) {
    if (key.charCodeAt(0) === 33 /* '!' */) continue; // claves especiales (!ref, !cols, !merges...)
    const cellValue = (sheet as Record<string, XLSX.CellObject | undefined>)[key]?.v;
    if (cellValue === undefined || cellValue === null || cellValue === "") continue;
    populatedRows.push(XLSX.utils.decode_cell(key).r);
  }
  if (populatedRows.length === 0) return;
  populatedRows.sort((a, b) => a - b);

  let lastRealRow = populatedRows[0];
  for (let i = 1; i < populatedRows.length; i++) {
    if (populatedRows[i] - populatedRows[i - 1] > gapThreshold) break;
    lastRealRow = populatedRows[i];
  }

  const current = XLSX.utils.decode_range(ref);
  if (lastRealRow >= current.e.r) return; // el rango declarado ya era ajustado
  sheet["!ref"] = XLSX.utils.encode_range({ s: current.s, e: { r: lastRealRow, c: current.e.c } });
}
