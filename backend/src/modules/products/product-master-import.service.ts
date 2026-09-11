// Fase 8R: rediseño del catálogo de productos -- carga masiva desde el
// formato de columnas REAL de Bigmat (ver product-master-parser.ts) y
// "vaciado" seguro del catálogo actual.
//
// Por qué el vaciado no es un simple `deleteMany`: Product.orderLines tiene
// una relación obligatoria (OrderLine.productId, sin onDelete: Cascade) --
// un producto que ya está en un pedido real no se puede borrar sin romper el
// histórico de ese pedido (el propio Postgres lo impediría con un error de
// FK). Como Raúl pidió explícitamente "borrar todo el catálogo y empezar de
// cero" para poder recargarlo con el nuevo formato, wipeProductCatalog hace
// lo más parecido a eso que es seguro: borra de verdad los productos que
// nunca se han usado en ningún pedido, y para los que sí se han usado los
// desactiva (active=false, deletedAt=now()) -- desaparecen igual de
// Maestros > Productos y de cualquier pantalla nueva, pero los pedidos que
// ya los referencian (y sus PDF de albarán/carta de porte) siguen
// funcionando exactamente igual.
import { prisma } from "@/lib/prisma";
import { parseProductsWorkbook, type ParsedProductRow } from "./lib/product-master-parser";
import {
  createProductImportJob,
  updateProductImportJob,
  getProductImportJob,
} from "./lib/product-import-jobs.store";

export { buildProductMasterTemplate } from "./lib/product-master-parser";

export interface ProductImportErrorRow {
  codigo: string;
  motivo: string;
}

export interface ProductMasterImportSummary {
  filasLeidas: number;
  productosDetectados: number;
  productosCreados: number;
  productosActualizados: number;
  erroresParseo: string[];
  errores: ProductImportErrorRow[];
}

export interface ProductCatalogWipeSummary {
  eliminados: number;
  desactivados: number;
}

// Mismo pool de concurrencia fija duplicado a propósito (ver
// customer-master-import.service.ts) para que este servicio no dependa del
// de Pedidos ni del de Clientes. Cada fila hace como mucho 2 consultas
// (buscar + crear/actualizar), más ligero que una línea de pedido -- se usa
// algo más de concurrencia que en el maestro de clientes porque el catálogo
// real de Bigmat puede tener varios miles de filas.
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  async function runSlot(): Promise<void> {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await worker(item);
    }
  }
  const slots = Array.from({ length: Math.min(limit, items.length) }, () => runSlot());
  await Promise.all(slots);
}

const IMPORT_CONCURRENCY = 8;

// Deriva lengthM/widthM/heightM (metros) a partir de las medidas de Palet en
// cm de la plantilla, para que el motor de cálculo de volumen por ruta
// (recalculateLoadPlan, en routes.routes.ts) siga funcionando sin tocarlo --
// ver comentario en Product.unitDepthCm/... en schema.prisma.
function derivePalletMeters(row: Pick<ParsedProductRow, "palletDepthCm" | "palletWidthCm" | "palletHeightCm">) {
  if (row.palletDepthCm == null || row.palletWidthCm == null || row.palletHeightCm == null) return {};
  return {
    lengthM: row.palletDepthCm / 100,
    widthM: row.palletWidthCm / 100,
    heightM: row.palletHeightCm / 100,
  };
}

async function importOneProduct(
  companyId: string,
  row: ParsedProductRow,
  summary: ProductMasterImportSummary
): Promise<void> {
  const rowLabel = row.internalCode || row.ean || `fila ${row.rowNumber}`;
  try {
    let existing: { id: string } | null = null;
    if (row.internalCode) {
      existing = await prisma.product.findFirst({ where: { companyId, internalCode: row.internalCode } });
    }
    if (!existing && row.ean) {
      existing = await prisma.product.findUnique({ where: { sku: row.ean } });
    }

    const data = {
      description: row.description,
      internalCode: row.internalCode,
      supplier: row.supplier,
      category: row.category,
      salesUnit: row.baseUnit,
      measurementUnit: row.measurementUnit,
      unitsPerBox: row.unitsPerBox,
      unitsPerPallet: row.unitsPerPallet,
      ean: row.ean,
      abcClass: row.abcClass,
      unitDepthCm: row.unitDepthCm,
      unitWidthCm: row.unitWidthCm,
      unitHeightCm: row.unitHeightCm,
      boxDepthCm: row.boxDepthCm,
      boxWidthCm: row.boxWidthCm,
      boxHeightCm: row.boxHeightCm,
      palletDepthCm: row.palletDepthCm,
      palletWidthCm: row.palletWidthCm,
      palletHeightCm: row.palletHeightCm,
      stackable: row.stackable,
      stackableLayers: row.stackableLayers,
      storageConditions: row.storageConditions,
      weightUnit: row.weightUnit,
      packagingType: row.packagingType,
      minOrderQtyB2c: row.minOrderQtyB2c,
      ...derivePalletMeters(row),
    };

    if (existing) {
      // Un producto reactivado por una nueva carga (estaba desactivado por un
      // vaciado anterior, ver wipeProductCatalog) vuelve a quedar activo y
      // visible -- vuelve a existir de verdad en el catálogo.
      await prisma.product.update({
        where: { id: existing.id },
        data: { ...data, active: true, deletedAt: null } as any,
      });
      summary.productosActualizados += 1;
    } else {
      // sku es obligatorio y único en todo el sistema (ver schema.prisma):
      // se usa el Código EAN, y si la fila no trae EAN (solo CODIGO interno,
      // permitido por el parser) se usa el propio CODIGO como sku provisional
      // -- mejor tener el producto operativo desde ya que bloquear la carga
      // por falta de EAN.
      const sku = row.ean || row.internalCode!;
      await prisma.product.create({
        data: { ...data, companyId, sku, active: true } as any,
      });
      summary.productosCreados += 1;
    }
  } catch (err: any) {
    summary.errores.push({ codigo: rowLabel, motivo: err?.message ?? "Error desconocido" });
  }
}

async function processProductImportJob(
  jobId: string,
  companyId: string,
  rows: ParsedProductRow[],
  summary: ProductMasterImportSummary
): Promise<void> {
  await runWithConcurrency(rows, IMPORT_CONCURRENCY, async (row) => {
    await importOneProduct(companyId, row, summary);
    const job = getProductImportJob(jobId);
    updateProductImportJob(jobId, { processedProducts: (job?.processedProducts ?? 0) + 1 });
  });
  updateProductImportJob(jobId, { status: "done", summary });
}

// Responde de inmediato con un identificador de trabajo -- el procesamiento
// real ocurre en segundo plano (ver comentario en product-import-jobs.store.ts).
export function startProductMasterImportJob(
  companyId: string,
  buffer: Buffer
): { importId: string; totalProducts: number; parseErrors: string[] } {
  const { products, parseErrors, rowsRead } = parseProductsWorkbook(buffer);

  const summary: ProductMasterImportSummary = {
    filasLeidas: rowsRead,
    productosDetectados: products.length,
    productosCreados: 0,
    productosActualizados: 0,
    erroresParseo: parseErrors,
    errores: [],
  };

  const job = createProductImportJob(products.length);

  // Fire-and-forget deliberado, igual que startOrdersExcelImportJob: el
  // resultado se consulta con GET /products/import/:importId/status.
  void processProductImportJob(job.id, companyId, products, summary).catch((err) => {
    updateProductImportJob(job.id, { status: "error", error: err?.message ?? "Error desconocido" });
  });

  return { importId: job.id, totalProducts: products.length, parseErrors };
}

// "Vaciar el catálogo actual" (petición explícita de Raúl al rediseñar
// Productos) -- ver comentario de cabecera del fichero para por qué esto no
// es un DELETE sin más.
export async function wipeProductCatalog(companyId: string): Promise<ProductCatalogWipeSummary> {
  const products: Array<{ id: string; _count: { orderLines: number } }> = await prisma.product.findMany({
    where: { companyId, deletedAt: null },
    select: { id: true, _count: { select: { orderLines: true } } },
  });

  const idsWithoutOrders = products.filter((p) => p._count.orderLines === 0).map((p) => p.id);
  const idsWithOrders = products.filter((p) => p._count.orderLines > 0).map((p) => p.id);

  let eliminados = 0;
  if (idsWithoutOrders.length > 0) {
    const res = await prisma.product.deleteMany({ where: { id: { in: idsWithoutOrders } } });
    eliminados = res.count;
  }

  let desactivados = 0;
  if (idsWithOrders.length > 0) {
    const res = await prisma.product.updateMany({
      where: { id: { in: idsWithOrders } },
      data: { active: false, deletedAt: new Date() },
    });
    desactivados = res.count;
  }

  return { eliminados, desactivados };
}
