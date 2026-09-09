// Carga de pedidos por Excel (instrucciones ampliadas del proyecto: "Recepción
// de pedidos desde cualquier origen -- ERP, API o carga manual"). El bridge de
// ERP Claud (`erpclaud.service.ts`) ya cubre la vía API con un contrato JSON
// estricto que exige que el cliente y los SKUs ya existan; este módulo cubre
// la vía manual -- alguien de Bigmat sube un Excel para meter pedidos de
// prueba o para un cliente que todavía no llega por integración -- así que es
// deliberadamente más permisivo: crea el cliente, el punto de entrega y el
// producto que falten en vez de rechazar la fila, y sigue con el resto del
// lote si un pedido concreto falla (igual que erpclaud.service.ts).
//
// La consulta de estado por parte del cliente NO crea un usuario ni una
// contraseña por cliente (decisión explícita de Raúl: "sería más
// recomendable y práctico hacer un acceso único para todos, con la única
// diferencia de visibilidad por consulta de número de pedido" -- así se
// ahorran altas de cliente, contraseñas que se pierden, y solo hay
// visibilidad del pedido concreto que se consulta). Ver
// `@/modules/tracking/tracking.routes.ts`: consulta pública por Nº de pedido
// + código postal, sin usuario ni contraseña.
//
// Se ejecuta como un job en segundo plano (ver ./lib/import-jobs.store.ts):
// un lote real (miles de pedidos) tarda varios minutos porque cada pedido
// hace varias idas y vueltas a la base de datos dentro de su propia
// transacción -- si el POST esperase a que terminase todo el lote, la
// petición HTTP se cortaba con un error de red antes de recibir respuesta
// (justo lo que reportó Raúl). Ahora el POST devuelve enseguida un
// identificador de trabajo y el frontend va consultando el progreso; además
// los pedidos se procesan con concurrencia limitada (varios a la vez, no uno
// detrás de otro) para que el lote completo tarde bastante menos.
//
// El parseo del Excel (sin acceso a base de datos) vive aparte, en
// ./lib/excel-import-parser.ts, para poder probarlo de forma aislada.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeLineWeightKg } from "./lib/line-weight";
import { classifyOrder, getActiveSegmentationRules } from "@/modules/segmentation/segmentation.service";
import { createImportJob, updateImportJob } from "./lib/import-jobs.store";
import {
  parseOrdersWorkbook,
  slugifyBusinessCode,
  type ParsedOrder,
  type ParsedOrderLine,
} from "./lib/excel-import-parser";

export { buildOrdersImportTemplate } from "./lib/excel-import-parser";

export const EXCEL_SOURCE_SYSTEM = "excel_import" as const;

export interface ImportErrorRow {
  pedido: string;
  motivo: string;
}

export interface CreatedCustomerInfo {
  customerId: string;
  businessCode: string;
  legalName: string;
}

export interface OrdersImportSummary {
  filasLeidas: number;
  pedidosDetectados: number;
  pedidosCreados: number;
  pedidosOmitidos: number;
  erroresParseo: string[];
  errores: ImportErrorRow[];
  clientesCreados: CreatedCustomerInfo[];
  productosCreadosAutomaticamente: string[];
}

// Ejecuta `worker` sobre `items` con como mucho `limit` tareas en paralelo a
// la vez (en vez de una detrás de otra, o todas de golpe). Sin librería
// nueva -- es un pool de tamaño fijo minimalista: cada "hueco" coge el
// siguiente item disponible en cuanto termina el anterior.
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

async function resolveWarehouseId(
  tx: Prisma.TransactionClient,
  companyId: string,
  warehouseName: string | undefined
): Promise<string> {
  if (warehouseName) {
    const match = await tx.warehouse.findFirst({
      where: { companyId, active: true, name: { contains: warehouseName, mode: "insensitive" } },
    });
    if (match) return match.id;
  }
  const warehouses = await tx.warehouse.findMany({ where: { companyId, active: true }, select: { id: true } });
  if (warehouses.length === 1) return warehouses[0].id;
  if (warehouses.length === 0) throw new Error("La empresa no tiene ningún almacén activo configurado");
  throw new Error(
    warehouseName
      ? `No se ha encontrado ningún almacén activo que coincida con "${warehouseName}"`
      : `Hay ${warehouses.length} almacenes activos: la plantilla debe indicar la columna "Almacén"`
  );
}

async function resolveCustomerAndDeliveryPoint(
  tx: Prisma.TransactionClient,
  companyId: string,
  parsed: ParsedOrder,
  summary: OrdersImportSummary
): Promise<{ customerId: string; deliveryPointId: string }> {
  const businessCode = parsed.customerCode?.trim().slice(0, 10) || slugifyBusinessCode(parsed.customerName ?? "");

  let customer = await tx.customer.findUnique({ where: { companyId_businessCode: { companyId, businessCode } } });

  if (customer) {
    // Cliente ya existente: se actualizan razón social/CIF solo si la
    // plantilla trae un valor y difiere, igual que hace el bridge de ERP
    // Claud -- nunca se borra un dato ya cargado por dejarlo en blanco.
    const patch: Prisma.CustomerUpdateInput = {};
    if (parsed.customerName && parsed.customerName !== customer.legalName) patch.legalName = parsed.customerName;
    if (parsed.customerTaxId && parsed.customerTaxId !== customer.taxId) patch.taxId = parsed.customerTaxId;
    if (Object.keys(patch).length > 0) {
      customer = await tx.customer.update({ where: { id: customer.id }, data: patch });
    }
  } else {
    if (!parsed.customerName) {
      throw new Error(`Falta el nombre del cliente (columna "Cliente") para darlo de alta con el código ${businessCode}`);
    }
    customer = await tx.customer.create({
      data: {
        companyId,
        businessCode,
        legalName: parsed.customerName,
        taxId: parsed.customerTaxId,
      },
    });
    summary.clientesCreados.push({ customerId: customer.id, businessCode: customer.businessCode, legalName: customer.legalName });
  }

  if (!parsed.address || !parsed.city || !parsed.province || !parsed.postalCode) {
    throw new Error(
      "Faltan datos de la dirección de entrega (dirección, población, provincia y/o código postal son obligatorios)"
    );
  }

  const existingDp = await tx.deliveryPoint.findFirst({
    where: {
      customerId: customer.id,
      address: { equals: parsed.address, mode: "insensitive" },
      postalCode: parsed.postalCode,
      deletedAt: null,
    },
  });

  const deliveryPoint =
    existingDp ??
    (await tx.deliveryPoint.create({
      data: {
        customerId: customer.id,
        address: parsed.address,
        city: parsed.city,
        province: parsed.province,
        postalCode: parsed.postalCode,
        country: "ES",
        contactPhone: parsed.contactPhone,
        contactEmail: parsed.customerEmail,
      },
    }));

  return { customerId: customer.id, deliveryPointId: deliveryPoint.id };
}

async function resolveOrCreateProduct(
  tx: Prisma.TransactionClient,
  companyId: string,
  line: ParsedOrderLine,
  summary: OrdersImportSummary
) {
  let product = await tx.product.findUnique({ where: { sku: line.sku } });
  if (!product) {
    // Producto de prueba mínimo: mismo criterio que ya se aplica a cualquier
    // producto del catálogo sin dimensiones cargadas (import-surtido.ts) --
    // se puede operar con él, y se completa a mano desde Maestros > Productos
    // cuando se conozcan sus datos reales. El peso de 1kg es un valor
    // deliberadamente reconocible como "placeholder", no una estimación.
    product = await tx.product.create({
      data: {
        companyId,
        sku: line.sku,
        description: line.description || line.sku,
        salesUnit: line.unit,
        unitsPerPallet: 1,
        grossWeightKg: 1,
        fullPalletWeightKg: 1,
        active: true,
      },
    });
    if (!summary.productosCreadosAutomaticamente.includes(line.sku)) {
      summary.productosCreadosAutomaticamente.push(line.sku);
    }
  }
  return product;
}

async function importOneOrder(
  companyId: string,
  parsed: ParsedOrder,
  segmentationRules: Awaited<ReturnType<typeof getActiveSegmentationRules>>,
  summary: OrdersImportSummary
): Promise<void> {
  try {
    if (parsed.lines.length === 0) {
      throw new Error("El pedido no tiene ninguna línea con SKU y cantidad válidos");
    }
    if (!parsed.requestedDeliveryDate) {
      throw new Error('Falta la fecha de entrega solicitada (columna "Fecha de entrega solicitada")');
    }

    const existingOrder = await prisma.order.findUnique({ where: { orderNumber: parsed.orderNumber } });
    if (existingOrder) {
      summary.pedidosOmitidos += 1;
      summary.errores.push({
        pedido: parsed.orderNumber,
        motivo: "Ya existe un pedido con este número; se omite para no duplicarlo",
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const { customerId, deliveryPointId } = await resolveCustomerAndDeliveryPoint(tx, companyId, parsed, summary);
      const warehouseId = await resolveWarehouseId(tx, companyId, parsed.warehouseName);

      const products = await Promise.all(
        parsed.lines.map((line) => resolveOrCreateProduct(tx, companyId, line, summary))
      );
      const productBySku = new Map(products.map((p) => [p.sku, p]));

      const order = await tx.order.create({
        data: {
          companyId,
          orderNumber: parsed.orderNumber,
          customerId,
          deliveryPointId,
          warehouseId,
          status: "received",
          requestedDeliveryDate: parsed.requestedDeliveryDate!,
          deliveryTimeWindowFrom: parsed.windowFrom,
          deliveryTimeWindowTo: parsed.windowTo,
          notes: parsed.notes,
          externalSourceSystem: EXCEL_SOURCE_SYSTEM,
          externalOrderId: parsed.orderNumber,
          createdAt: parsed.orderDate ?? new Date(),
        },
      });

      await tx.orderLine.createMany({
        data: parsed.lines.map((line) => {
          const product = productBySku.get(line.sku)!;
          return {
            orderId: order.id,
            productId: product.id,
            quantity: line.quantity,
            unit: line.unit,
            lineWeightKg: computeLineWeightKg(line.unit, line.quantity, {
              grossWeightKg: Number(product.grossWeightKg),
              fullPalletWeightKg: Number(product.fullPalletWeightKg),
            }),
          };
        }),
      });

      await classifyOrder(tx, companyId, order.id, segmentationRules);
    });

    summary.pedidosCreados += 1;
  } catch (err: any) {
    summary.errores.push({ pedido: parsed.orderNumber, motivo: err?.message ?? "Error desconocido" });
  }
}

// Concurrencia conservadora: suficiente para acortar mucho el tiempo total de
// un lote grande sin arriesgarse a agotar el pool de conexiones de Postgres
// (cada pedido abre su propia transacción).
const IMPORT_CONCURRENCY = 4;

async function processOrdersImportJob(jobId: string, companyId: string, orders: ParsedOrder[], summary: OrdersImportSummary) {
  try {
    const segmentationRules = await getActiveSegmentationRules(prisma, companyId);

    let processed = 0;
    await runWithConcurrency(orders, IMPORT_CONCURRENCY, async (parsed) => {
      await importOneOrder(companyId, parsed, segmentationRules, summary);
      processed += 1;
      updateImportJob(jobId, { processedOrders: processed });
    });

    updateImportJob(jobId, { status: "done", processedOrders: orders.length, summary });
  } catch (err: any) {
    updateImportJob(jobId, { status: "error", error: err?.message ?? "Error desconocido durante la importación" });
  }
}

// Punto de entrada del endpoint POST /orders/import: parsea el Excel (rápido,
// sin base de datos) y lanza el procesamiento real EN SEGUNDO PLANO -- no se
// espera (`await`) a que termine, así el endpoint responde de inmediato con
// un identificador de trabajo en vez de dejar la petición HTTP colgada
// mientras se procesan potencialmente miles de pedidos.
export function startOrdersExcelImportJob(companyId: string, buffer: Buffer): { importId: string; totalOrders: number } {
  const { orders, parseErrors, rowsRead } = parseOrdersWorkbook(buffer);

  const summary: OrdersImportSummary = {
    filasLeidas: rowsRead,
    pedidosDetectados: orders.length,
    pedidosCreados: 0,
    pedidosOmitidos: 0,
    erroresParseo: parseErrors,
    errores: [],
    clientesCreados: [],
    productosCreadosAutomaticamente: [],
  };

  const job = createImportJob(orders.length);

  // Fire-and-forget deliberado: el resultado se consulta con
  // GET /orders/import/:importId/status, nunca por el valor de retorno de
  // esta llamada. El .catch es una red de seguridad para que un fallo
  // inesperado no se convierta en un unhandled rejection silencioso.
  void processOrdersImportJob(job.id, companyId, orders, summary).catch((err) => {
    updateImportJob(job.id, { status: "error", error: err?.message ?? "Error desconocido" });
  });

  return { importId: job.id, totalOrders: orders.length };
}
