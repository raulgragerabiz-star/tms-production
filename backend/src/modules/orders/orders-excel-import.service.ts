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
// Además, cuando un pedido de esta carga trae un cliente que no existía
// todavía, se le da de alta automáticamente un usuario de Portal Cliente
// (mismo modelo AppUser que ya usa Maestros > Usuarios) para que pueda
// consultar su pedido actual y los futuros sin que nadie tenga que crearlo a
// mano -- tal y como pidió Raúl. La contraseña generada solo se puede leer en
// la respuesta de esta importación (se guarda como hash, igual que cualquier
// otro usuario); si se pierde, se resetea desde Maestros > Usuarios como a
// cualquier otro usuario.
//
// El parseo del Excel (sin acceso a base de datos) vive aparte, en
// ./lib/excel-import-parser.ts, para poder probarlo de forma aislada.
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { computeLineWeightKg } from "./lib/line-weight";
import { classifyOrder, getActiveSegmentationRules } from "@/modules/segmentation/segmentation.service";
import {
  generateTempPassword,
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

export interface CreatedCustomerCredential {
  customerId: string;
  businessCode: string;
  legalName: string;
  email: string;
  password: string;
}

export interface OrdersImportSummary {
  filasLeidas: number;
  pedidosDetectados: number;
  pedidosCreados: number;
  pedidosOmitidos: number;
  erroresParseo: string[];
  errores: ImportErrorRow[];
  clientesCreados: CreatedCustomerCredential[];
  productosCreadosAutomaticamente: string[];
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
  let customerCreated = false;

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
    customerCreated = true;
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

  // Alta automática del usuario de Portal Cliente -- solo la primera vez que
  // se crea el cliente (una reimportación posterior con el mismo código no
  // debe regenerar ni invalidar una contraseña que el cliente ya esté
  // usando). Si ya existiera por cualquier otro motivo un usuario de portal
  // para este cliente, tampoco se toca.
  if (customerCreated) {
    const existingPortalUser = await tx.appUser.findFirst({
      where: { customerId: customer.id, userType: "customer_portal" },
    });
    if (!existingPortalUser) {
      const baseEmail = parsed.customerEmail?.trim() || `${businessCode.toLowerCase()}@clientes.bigmat-tms.local`;
      let email = baseEmail;
      let attempt = 0;
      // Muy improbable que colisione (el businessCode es único por empresa),
      // pero si el email SÍ viene relleno en la plantilla podría coincidir
      // con uno ya existente -- en vez de reventar toda la importación por
      // eso, se añade un sufijo y se sigue.
      while (attempt <= 5) {
        const clash = await tx.appUser.findUnique({ where: { email } });
        if (!clash) break;
        attempt += 1;
        const [local, domain] = baseEmail.split("@");
        email = `${local}+${attempt}@${domain}`;
      }

      const password = generateTempPassword();
      const passwordHash = await bcrypt.hash(password, 10);
      await tx.appUser.create({
        data: {
          companyId,
          email,
          fullName: customer.legalName,
          passwordHash,
          userType: "customer_portal",
          customerId: customer.id,
          active: true,
        },
      });
      summary.clientesCreados.push({
        customerId: customer.id,
        businessCode: customer.businessCode,
        legalName: customer.legalName,
        email,
        password,
      });
    }
  }

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

export async function runOrdersExcelImport(companyId: string, buffer: Buffer): Promise<OrdersImportSummary> {
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

  const segmentationRules = await getActiveSegmentationRules(prisma, companyId);

  for (const parsed of orders) {
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
        continue;
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

  return summary;
}
