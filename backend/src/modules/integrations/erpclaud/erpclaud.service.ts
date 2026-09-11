import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeLineWeightKg } from "@/modules/orders/lib/line-weight";
import { classifyOrder, getActiveSegmentationRules } from "@/modules/segmentation/segmentation.service";
import { geocodeDeliveryPointIfMissing } from "@/modules/delivery-points/delivery-points.service";

export const SOURCE_SYSTEM = "erpclaud" as const;

interface ErpclaudLinea {
  sku: string;
  descripcion?: string;
  cantidad: number;
  unidad: string;
  pesoKg?: number; // peso TOTAL de la línea, si el ERP lo manda ya calculado
}

interface ErpclaudPedido {
  externalOrderId: string;
  almacenCodigo?: string; // correlaciona con warehouse.externalCode; si se omite, requiere almacén único activo
  socio: { codigo: string; nombre: string; nifCif?: string };
  direccionEntrega: {
    label?: string;
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

export interface ErpclaudImportPayload {
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
 * Resuelve (o crea) el cliente y el punto de entrega correspondientes a un
 * "socio"/dirección de entrega del ERP. No reimplementa un motor de
 * matching/MDM completo (deduplicación difusa, survivorship de campos entre
 * fuentes) — eso queda fuera de esta primera versión; aquí el emparejamiento
 * es exacto por `businessCode` (código de socio del ERP) dentro de la
 * empresa, y por dirección+CP para el punto de entrega. Es intencionalmente
 * simple y auditable; si en el futuro hace falta matching difuso, se añade
 * como una capa por encima sin tocar el contrato de este bridge.
 */
async function resolveCustomerAndDeliveryPoint(
  tx: Prisma.TransactionClient,
  companyId: string,
  pedido: ErpclaudPedido
): Promise<{ customerId: string; deliveryPointId: string; customerCreated: boolean }> {
  const businessCode = pedido.socio.codigo.trim();

  const existingCustomer = await tx.customer.findUnique({
    where: { companyId_businessCode: { companyId, businessCode } },
  });

  const customer = await tx.customer.upsert({
    where: { companyId_businessCode: { companyId, businessCode } },
    update: {
      legalName: pedido.socio.nombre,
      ...(pedido.socio.nifCif ? { taxId: pedido.socio.nifCif } : {}),
    },
    create: {
      companyId,
      businessCode,
      legalName: pedido.socio.nombre,
      taxId: pedido.socio.nifCif,
    },
  });

  const dir = pedido.direccionEntrega;
  const existingDp = await tx.deliveryPoint.findFirst({
    where: {
      customerId: customer.id,
      address: { equals: dir.address, mode: "insensitive" },
      postalCode: dir.postalCode,
      deletedAt: null,
    },
  });

  const deliveryPoint =
    existingDp ??
    (await tx.deliveryPoint.create({
      data: {
        customerId: customer.id,
        label: dir.label,
        address: dir.address,
        postalCode: dir.postalCode,
        city: dir.city,
        province: dir.province,
        country: "ES",
        lat: dir.lat,
        lng: dir.lng,
      },
    }));

  return { customerId: customer.id, deliveryPointId: deliveryPoint.id, customerCreated: !existingCustomer };
}

/**
 * Resuelve el almacén de origen del pedido. El payload de erpclaud no trae un
 * almacén "de entrega" (esa es la dirección del cliente) sino que necesita
 * decirnos desde qué almacén propio sale — se correlaciona vía
 * `almacenCodigo` contra `warehouse.external_code` (columna ya existente en
 * el schema para este mismo propósito, ver warehouses.routes.ts
 * `/by-external-code`). Si el pedido no trae código y la empresa solo tiene
 * un almacén activo, se usa ese por defecto.
 */
async function resolveWarehouseId(tx: Prisma.TransactionClient, companyId: string, almacenCodigo?: string) {
  if (almacenCodigo) {
    const wh = await tx.warehouse.findFirst({ where: { companyId, externalCode: almacenCodigo, active: true } });
    if (!wh) {
      throw new Error(`Almacén con código externo "${almacenCodigo}" no encontrado o inactivo`);
    }
    return wh.id;
  }

  const warehouses = await tx.warehouse.findMany({ where: { companyId, active: true }, select: { id: true } });
  if (warehouses.length === 1) return warehouses[0].id;
  if (warehouses.length === 0) {
    throw new Error("La empresa no tiene ningún almacén activo configurado");
  }
  throw new Error(
    `La empresa tiene ${warehouses.length} almacenes activos: el pedido debe indicar "almacenCodigo" (external_code del almacén)`
  );
}

/**
 * Núcleo de importación desde erpclaud. Idempotente por
 * (companyId, externalSourceSystem, externalOrderId): reimportar el mismo
 * pedido actualiza sus líneas y cabecera en vez de duplicarlo, pero NUNCA
 * pisa el estado de ciclo de vida (`status`) de un pedido que ya avanzó más
 * allá de "received" — solo se fija `status: "received"` en la creación.
 */
export async function processErpclaudImport(companyId: string, payload: ErpclaudImportPayload): Promise<ImportSummary> {
  const summary: ImportSummary = {
    pedidosRecibidos: payload.pedidos.length,
    ordersCreados: 0,
    ordersActualizados: 0,
    clientesResueltos: 0,
    errores: [],
  };

  // OPTIMIZACIÓN: precargar reglas de segmentación y catálogo de productos UNA
  // vez fuera del bucle, en vez de repetirlo por cada uno de los N pedidos del
  // lote (evita N SELECTs redundantes en un import de cientos de pedidos).
  const segmentationRules = await getActiveSegmentationRules(prisma, companyId);

  const allSkus = Array.from(new Set(payload.pedidos.flatMap((p) => p.lineas.map((l) => l.sku))));
  const allProducts = await prisma.product.findMany({
    where: { companyId, sku: { in: allSkus } },
    select: { id: true, sku: true, grossWeightKg: true, fullPalletWeightKg: true },
  });
  const productBySku = new Map(allProducts.map((p) => [p.sku, p]));

  for (const pedido of payload.pedidos) {
    try {
      const missing = pedido.lineas.map((l) => l.sku).filter((s) => !productBySku.has(s));
      if (missing.length > 0) {
        throw new Error(`SKUs no encontrados en catálogo: ${missing.join(", ")}`);
      }

      // Fase 8c: se guarda fuera de la transacción para poder geocodificar el
      // punto de entrega DESPUÉS de que el pedido ya se ha confirmado (nunca
      // dentro de un `tx`, por ser una llamada de red externa) -- si el ERP
      // ya manda dir.lat/dir.lng, geocodeDeliveryPointIfMissing lo detecta y
      // no hace ninguna llamada de más.
      let deliveryPointIdForGeocoding: string | undefined;

      await prisma.$transaction(async (tx) => {
        const { customerId, deliveryPointId, customerCreated } = await resolveCustomerAndDeliveryPoint(
          tx,
          companyId,
          pedido
        );
        deliveryPointIdForGeocoding = deliveryPointId;
        if (customerCreated) summary.clientesResueltos += 1;

        const warehouseId = await resolveWarehouseId(tx, companyId, pedido.almacenCodigo);

        const existing = await tx.order.findFirst({
          where: { companyId, externalSourceSystem: SOURCE_SYSTEM, externalOrderId: pedido.externalOrderId },
          select: { id: true },
        });

        const order = existing
          ? await tx.order.update({
              where: { id: existing.id },
              data: {
                customerId,
                deliveryPointId,
                warehouseId,
                requestedDeliveryDate: new Date(pedido.fechaPromesa),
                // No se toca `status`: un pedido reimportado que ya avanzó en el
                // ciclo de vida (planned/dispatched/...) no debe volver atrás.
              },
              select: { id: true },
            })
          : await tx.order.create({
              data: {
                companyId,
                customerId,
                deliveryPointId,
                warehouseId,
                externalSourceSystem: SOURCE_SYSTEM,
                externalOrderId: pedido.externalOrderId,
                orderNumber: `ERPC-${pedido.externalOrderId}`,
                requestedDeliveryDate: new Date(pedido.fechaPromesa),
                createdAt: new Date(pedido.fechaCreacion),
                status: "received",
              },
              select: { id: true },
            });

        if (existing) summary.ordersActualizados += 1;
        else summary.ordersCreados += 1;

        // OPTIMIZACIÓN: reemplazo de líneas con un único `createMany` en vez de
        // un `create` por línea dentro de un bucle (1 DELETE + 1 INSERT por
        // pedido en vez de N round-trips, sea cual sea el número de líneas).
        await tx.orderLine.deleteMany({ where: { orderId: order.id } });

        const linesData = pedido.lineas.map((linea) => {
          const product = productBySku.get(linea.sku)!;
          const lineWeightKg =
            linea.pesoKg ??
            computeLineWeightKg(linea.unidad, linea.cantidad, {
              grossWeightKg: product.grossWeightKg == null ? null : Number(product.grossWeightKg),
              fullPalletWeightKg: product.fullPalletWeightKg == null ? null : Number(product.fullPalletWeightKg),
            });

          return {
            orderId: order.id,
            productId: product.id,
            quantity: linea.cantidad,
            unit: linea.unidad,
            lineWeightKg,
          };
        });

        await tx.orderLine.createMany({ data: linesData });

        // Clasificar segmento (peso/palés) + lead time, usando las reglas ya
        // precargadas fuera del bucle.
        await classifyOrder(tx, companyId, order.id, segmentationRules);
      });

      // Fase 8c: geocodificación "best effort", ya con el pedido confirmado.
      // Si falla, el pedido se cuenta igual como creado/actualizado -- solo
      // se queda sin coordenadas, igual que antes de este cambio.
      if (deliveryPointIdForGeocoding) {
        await geocodeDeliveryPointIfMissing(deliveryPointIdForGeocoding);
      }
    } catch (err: any) {
      summary.errores.push({
        externalOrderId: pedido.externalOrderId,
        motivo: err?.message ?? "error desconocido",
      });
    }
  }

  return summary;
}
