import { prisma } from "../../../lib/prisma"; // cliente Prisma singleton ya existente en el proyecto
import { resolveOrCreateCustomer } from "../wms/wms-bridge.service"; // núcleo de transformación ya construido (modulo-integracion-tms-wms.md)
import { classifyOrder, getActiveSegmentationRules } from "../../segmentation/segmentation.service";

export const SOURCE_SYSTEM = "erpclaud" as const;

interface ErpclaudLinea {
  sku: string;
  descripcion?: string;
  cantidad: number;
  unidad: string;
  pesoKg?: number;
  volumenM3?: number;
}

interface ErpclaudPedido {
  externalOrderId: string;
  socio: { codigo: string; nombre: string; nifCif?: string };
  direccionEntrega: {
    address: string;
    city: string;
    province: string;
    postalCode: string;
    lat?: number;
    lng?: number;
  };
  fechaCreacion: string;
  fechaPromesa: string;
  lineas: ErpclaudLinea[];
}

interface ErpclaudImportPayload {
  schemaVersion: "1.0";
  pedidos: ErpclaudPedido[];
}

export interface ImportSummary {
  pedidosRecibidos: number;
  ordersCreados: number;
  ordersActualizados: number;
  clientesResueltos: number;
  errores: { externalOrderId: string; motivo: string }[];
}

/**
 * Núcleo de importación desde erpclaud. NO duplica lógica de matching/MDM:
 * usa exactamente `resolveOrCreateCustomer()`, el mismo motor especificado
 * en motor-matching-survivorship.md y ya en producción para el bridge WMS.
 * Esta es la reutilización que el documento v1.1 §1 identifica como el
 * retorno directo de haber elevado el problema a MDM en su momento.
 */
export async function processErpclaudImport(
  companyId: string,
  payload: ErpclaudImportPayload
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    pedidosRecibidos: payload.pedidos.length,
    ordersCreados: 0,
    ordersActualizados: 0,
    clientesResueltos: 0,
    errores: [],
  };

  // ----------------------------------------------------------------------
  // OPTIMIZACIÓN 1: precargar TODO lo que no cambia por pedido, UNA vez
  // fuera del bucle, en vez de repetirlo por cada uno de los N pedidos del
  // lote. Antes: 1 SELECT de reglas + 1 SELECT de productos POR PEDIDO
  // (500 pedidos -> hasta 1000 queries solo en esta parte). Ahora: 2
  // queries totales para todo el lote, sea de 5 o de 500 pedidos.
  // ----------------------------------------------------------------------
  const segmentationRules = await getActiveSegmentationRules(prisma, companyId);

  const allSkus = Array.from(new Set(payload.pedidos.flatMap((p) => p.lineas.map((l) => l.sku))));
  const allProducts = await prisma.product.findMany({
    where: { companyId, sku: { in: allSkus } },
    select: { id: true, sku: true, grossWeightKg: true, volumeM3PerUnit: true },
  });
  const productBySku = new Map(allProducts.map((p) => [p.sku, p]));

  for (const pedido of payload.pedidos) {
    try {
      const missing = pedido.lineas.map((l) => l.sku).filter((s) => !productBySku.has(s));
      if (missing.length > 0) {
        throw new Error(`SKUs no encontrados en catálogo: ${missing.join(", ")}`);
      }

      await prisma.$transaction(async (tx) => {
        // 1. Resolver/crear cliente vía el motor de matching ya existente,
        //    sin reimplementar nada específico de erpclaud.
        const { customer, deliveryPoint, created: customerCreated } =
          await resolveOrCreateCustomer(tx, companyId, {
            sourceSystem: SOURCE_SYSTEM,
            externalCode: pedido.socio.codigo,
            legalName: pedido.socio.nombre,
            taxId: pedido.socio.nifCif,
            address: pedido.direccionEntrega,
          });

        if (customerCreated) summary.clientesResueltos += 1;

        // 2. Upsert del pedido por (companyId, externalSourceCode, externalOrderId)
        //    — mismo patrón idempotente que el bridge WMS.
        const existing = await tx.order.findFirst({
          where: {
            companyId,
            externalSourceSystem: SOURCE_SYSTEM,
            externalOrderId: pedido.externalOrderId,
          },
          select: { id: true },
        });

        const orderData = {
          companyId,
          customerId: customer.id,
          deliveryPointId: deliveryPoint.id,
          externalSourceSystem: SOURCE_SYSTEM,
          externalOrderId: pedido.externalOrderId,
          requestedDeliveryDate: new Date(pedido.fechaPromesa),
          status: "received" as const,
        };

        const order = existing
          ? await tx.order.update({ where: { id: existing.id }, data: orderData, select: { id: true } })
          : await tx.order.create({
              data: {
                ...orderData,
                orderNumber: `ERPC-${pedido.externalOrderId}`,
                createdAt: new Date(pedido.fechaCreacion),
              },
              select: { id: true },
            });

        if (existing) summary.ordersActualizados += 1;
        else summary.ordersCreados += 1;

        // ------------------------------------------------------------------
        // OPTIMIZACIÓN 2: reemplazo de líneas con un único `createMany` en
        // vez de un `create` por línea dentro de un bucle. Antes: N round
        // trips a BD por pedido (uno por línea); ahora: 1 DELETE + 1
        // INSERT por pedido, sea cual sea el número de líneas.
        // ------------------------------------------------------------------
        await tx.orderLine.deleteMany({ where: { orderId: order.id } });

        const linesData = pedido.lineas.map((linea) => {
          const product = productBySku.get(linea.sku)!;
          const lineWeightKg = linea.pesoKg ?? Number(product.grossWeightKg) * linea.cantidad;
          const volumeM3 =
            linea.volumenM3 ??
            (product.volumeM3PerUnit ? Number(product.volumeM3PerUnit) * linea.cantidad : null);

          return {
            orderId: order.id,
            productId: product.id,
            quantity: linea.cantidad,
            unit: linea.unidad,
            lineWeightKg,
            volumeM3,
          };
        });

        await tx.orderLine.createMany({ data: linesData });

        // 3. Clasificar segmento + lead time (§2.4), usando las reglas ya
        //    precargadas fuera del bucle (OPTIMIZACIÓN 1).
        await classifyOrder(tx as any, companyId, order.id, segmentationRules);
      });
    } catch (err: any) {
      summary.errores.push({
        externalOrderId: pedido.externalOrderId,
        motivo: err?.message ?? "error desconocido",
      });
    }
  }

  return summary;
}
