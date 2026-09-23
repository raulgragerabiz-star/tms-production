// Carga del maestro de clientes/socios (Código, Nombre, Dirección completa).
//
// Por qué hace falta: el Excel de Pedidos que exporta el ERP trae el código
// de cliente en cada línea, pero NO la dirección de entrega -- dentro del
// ERP esa dirección vive en la ficha del socio/cliente, no en la línea de
// pedido, así que al cargar pedidos todos fallaban por falta de dirección
// (columna "Dirección de entrega" vacía). Este maestro permite cargar antes
// las direcciones por código de cliente; la importación de pedidos
// (orders-excel-import.service.ts) las usa como valor por defecto cuando el
// pedido en sí no trae su propia dirección. Un pedido que SÍ trae dirección
// propia sigue teniendo prioridad sobre esta dirección por defecto.
//
// Volumen esperado mucho menor que el de pedidos (un cliente puede tener
// cientos de pedidos, pero aparece una sola vez en este maestro), así que
// -- a diferencia de la importación de pedidos -- esto se resuelve en el
// propio POST sin necesitar un job en segundo plano. Aun así se procesa con
// la misma concurrencia limitada que la importación de pedidos, por si el
// maestro de un cliente grande tiene varios miles de filas.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseCustomersWorkbook, parseActiveText, normalizeHeader, type ParsedCustomerRow } from "./lib/customer-master-parser";
import { geocodeDeliveryPointIfMissing } from "@/modules/delivery-points/delivery-points.service";

export { buildCustomerMasterTemplate } from "./lib/customer-master-parser";

export interface CustomerMasterErrorRow {
  codigo: string;
  motivo: string;
}

export interface CustomerMasterImportSummary {
  filasLeidas: number;
  clientesDetectados: number;
  clientesCreados: number;
  clientesActualizados: number;
  puntosDeEntregaCreados: number;
  // Mejora (2026-09-23): columnas "circuito"/"estado"/"Centro" de la
  // plantilla -- ver customer-master-parser.ts (HEADER_ALIASES) y
  // resolveZoneAssignment más abajo. Un circuito o un centro que no se
  // encuentre por nombre NO se inventa -- la fila se deja sin ese dato y se
  // añade a `errores` para revisar a mano (decisión explícita de Raúl).
  circuitosAsignados: number;
  sinCodigoPostalDetectado: string[];
  erroresParseo: string[];
  errores: CustomerMasterErrorRow[];
}

// Contexto resuelto UNA VEZ por importación entera (no por fila): traer
// todos los circuitos/almacenes de la empresa de antemano evita cientos de
// consultas sueltas a Postgres cuando la plantilla trae miles de filas, y
// permite comparar el texto de la plantilla contra el nombre real ya
// normalizado (sin acentos/mayúsculas/espacios de más, ver normalizeHeader).
interface ZoneAssignmentContext {
  zoneIdByName: Map<string, string>;
  warehouseIdByName: Map<string, string>;
}

async function buildZoneAssignmentContext(companyId: string): Promise<ZoneAssignmentContext> {
  const [zones, warehouses] = await Promise.all([
    prisma.deliveryZone.findMany({ where: { companyId }, select: { id: true, name: true } }),
    prisma.warehouse.findMany({ where: { companyId }, select: { id: true, name: true } }),
  ]);
  return {
    zoneIdByName: new Map(zones.map((z: { id: string; name: string }) => [normalizeHeader(z.name), z.id])),
    warehouseIdByName: new Map(warehouses.map((w: { id: string; name: string }) => [normalizeHeader(w.name), w.id])),
  };
}

// Aplica las columnas "circuito"/"Centro" de una fila ya con el cliente
// creado/actualizado. Reglas (decisión explícita de Raúl, AskUserQuestion):
// - Si el nombre de circuito no se encuentra, no se asigna nada y se avisa
//   en `errores` -- nunca se crea un circuito nuevo al vuelo (evita
//   duplicados por una errata en el Excel).
// - Si SÍ se encuentra el circuito, se guarda siempre como circuito POR
//   DEFECTO del cliente (Customer.deliveryZoneId) -- es lo que muestra la
//   columna "Circuito" del listado de Maestros > Clientes.
// - Si además la fila trae "Centro" y ese almacén también se encuentra, se
//   guarda TAMBIÉN como excepción por almacén (CustomerDeliveryZone, Fase
//   15) -- para clientes que reciben entregas desde varios almacenes con
//   circuitos distintos según cuál los sirva. Si el Centro no se encuentra,
//   el circuito por defecto ya aplicado arriba se mantiene igualmente; solo
//   se avisa en `errores` que la excepción por almacén no se pudo guardar.
async function applyZoneAssignment(
  customerId: string,
  row: ParsedCustomerRow,
  context: ZoneAssignmentContext,
  summary: CustomerMasterImportSummary
): Promise<void> {
  if (!row.deliveryZoneName) {
    if (row.warehouseName) {
      summary.errores.push({
        codigo: row.code,
        motivo: `Se indicó Centro "${row.warehouseName}" sin circuito -- no se ha asignado nada`,
      });
    }
    return;
  }

  const zoneId = context.zoneIdByName.get(normalizeHeader(row.deliveryZoneName));
  if (!zoneId) {
    summary.errores.push({
      codigo: row.code,
      motivo: `Circuito "${row.deliveryZoneName}" no encontrado -- da de alta ese circuito en Flota y Transportistas (o corrige el nombre) y vuelve a importar esta fila`,
    });
    return;
  }

  await prisma.customer.update({ where: { id: customerId }, data: { deliveryZoneId: zoneId } });
  summary.circuitosAsignados += 1;

  if (row.warehouseName) {
    const warehouseId = context.warehouseIdByName.get(normalizeHeader(row.warehouseName));
    if (!warehouseId) {
      summary.errores.push({
        codigo: row.code,
        motivo: `Centro "${row.warehouseName}" no encontrado -- se ha guardado igualmente el circuito por defecto, pero revisa el nombre del almacén para la excepción por centro`,
      });
      return;
    }
    await prisma.customerDeliveryZone.upsert({
      where: { customerId_warehouseId: { customerId, warehouseId } },
      create: { customerId, warehouseId, deliveryZoneId: zoneId },
      update: { deliveryZoneId: zoneId },
    });
  }
}

// Mismo pool de concurrencia fija que orders-excel-import.service.ts --
// duplicado a propósito (unas pocas líneas) en vez de importarlo de otro
// módulo, para que "Clientes" y "Pedidos" sigan siendo servicios
// independientes entre sí, tal y como pide la arquitectura del proyecto.
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

const IMPORT_CONCURRENCY = 4;

// Además de guardar la dirección por defecto en el propio Customer (para que
// la importación de Pedidos la use al resolver un pedido sin dirección
// propia), se da de alta -- o se reutiliza si ya existe -- un DeliveryPoint
// real para ese cliente. Sin esto, Maestros > Clientes seguía mostrando
// "0" en Puntos de entrega aunque el cliente ya tuviera una dirección
// cargada, porque esa columna cuenta filas de DeliveryPoint, no los campos
// por defecto del cliente. Mismo criterio de qué identifica un punto de
// entrega (dirección + código postal) que ya usa orders-excel-import.service.ts,
// para que este mismo punto se reutilice cuando llegue el primer pedido de
// ese cliente en vez de crear uno duplicado.
async function ensureDeliveryPoint(
  customerId: string,
  row: ParsedCustomerRow
): Promise<{ created: boolean; deliveryPointId: string }> {
  const address = row.address || row.addressRaw;
  const existingDp = await prisma.deliveryPoint.findFirst({
    where: {
      customerId,
      address: { equals: address, mode: "insensitive" },
      postalCode: row.postalCode ?? null,
      deletedAt: null,
    },
  });
  if (existingDp) return { created: false, deliveryPointId: existingDp.id };

  const created = await prisma.deliveryPoint.create({
    data: {
      customerId,
      address,
      city: row.city,
      province: row.province,
      postalCode: row.postalCode,
      country: "ES",
    },
  });
  return { created: true, deliveryPointId: created.id };
}

async function importOneCustomer(
  companyId: string,
  row: ParsedCustomerRow,
  context: ZoneAssignmentContext,
  summary: CustomerMasterImportSummary
): Promise<void> {
  try {
    const businessCode = row.code.trim().slice(0, 10);

    const existing = await prisma.customer.findUnique({
      where: { companyId_businessCode: { companyId, businessCode } },
    });

    const hasAddress = row.addressRaw.trim().length > 0;
    // Mejora (2026-09-23): columna "estado" -- undefined si viene en blanco o
    // con un valor no reconocido (ver parseActiveText), en cuyo caso no se
    // toca el estado actual del cliente.
    const activeValue = parseActiveText(row.activeRaw);
    if (row.activeRaw && activeValue === undefined) {
      summary.errores.push({
        codigo: row.code,
        motivo: `Estado "${row.activeRaw}" no reconocido (usa "Activo" o "Inactivo") -- no se ha cambiado el estado`,
      });
    }
    let customerId: string;

    if (existing) {
      const patch: Prisma.CustomerUpdateInput = {};
      if (row.name && row.name !== existing.legalName) patch.legalName = row.name;
      // Solo se pisa la dirección por defecto si esta fila trae una -- una
      // fila con la columna de dirección en blanco no borra la que ya
      // hubiera guardada.
      if (hasAddress) {
        patch.defaultAddress = row.address || row.addressRaw;
        patch.defaultCity = row.city ?? null;
        patch.defaultProvince = row.province ?? null;
        patch.defaultPostalCode = row.postalCode ?? null;
      }
      if (activeValue !== undefined) patch.active = activeValue;
      if (Object.keys(patch).length > 0) {
        await prisma.customer.update({ where: { id: existing.id }, data: patch });
      }
      customerId = existing.id;
      summary.clientesActualizados += 1;
    } else {
      if (!row.name) {
        throw new Error(`Falta el Nombre para dar de alta el cliente con código ${businessCode}`);
      }
      const created = await prisma.customer.create({
        data: {
          companyId,
          businessCode,
          legalName: row.name,
          defaultAddress: hasAddress ? row.address || row.addressRaw : undefined,
          defaultCity: row.city,
          defaultProvince: row.province,
          defaultPostalCode: row.postalCode,
          active: activeValue ?? undefined,
        },
      });
      customerId = created.id;
      summary.clientesCreados += 1;
    }

    await applyZoneAssignment(customerId, row, context, summary);

    if (hasAddress) {
      const { created, deliveryPointId } = await ensureDeliveryPoint(customerId, row);
      if (created) summary.puntosDeEntregaCreados += 1;
      // Fase 8c: geocodificación "best effort" también aquí -- este maestro
      // es precisamente el que carga la dirección por defecto que luego
      // heredan los pedidos de ese cliente (ver comentario al inicio del
      // fichero), así que geocodificarla aquí evita repetir la llamada por
      // cada pedido futuro del mismo cliente (el punto de entrega, una vez
      // geocodificado, se reutiliza tal cual).
      await geocodeDeliveryPointIfMissing(deliveryPointId);
    }

    if (hasAddress && !row.postalCode) {
      summary.sinCodigoPostalDetectado.push(businessCode);
    }
  } catch (err: any) {
    summary.errores.push({ codigo: row.code, motivo: err?.message ?? "Error desconocido" });
  }
}

export async function runCustomerMasterImport(companyId: string, buffer: Buffer): Promise<CustomerMasterImportSummary> {
  const { customers, parseErrors, rowsRead } = parseCustomersWorkbook(buffer);

  const summary: CustomerMasterImportSummary = {
    filasLeidas: rowsRead,
    clientesDetectados: customers.length,
    clientesCreados: 0,
    clientesActualizados: 0,
    puntosDeEntregaCreados: 0,
    circuitosAsignados: 0,
    sinCodigoPostalDetectado: [],
    erroresParseo: parseErrors,
    errores: [],
  };

  // Se resuelve una sola vez para toda la importación -- ver el comentario
  // de ZoneAssignmentContext más arriba.
  const context = await buildZoneAssignmentContext(companyId);

  await runWithConcurrency(customers, IMPORT_CONCURRENCY, (row) => importOneCustomer(companyId, row, context, summary));

  return summary;
}
