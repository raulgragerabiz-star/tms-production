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
import { parseCustomersWorkbook, type ParsedCustomerRow } from "./lib/customer-master-parser";

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
  sinCodigoPostalDetectado: string[];
  erroresParseo: string[];
  errores: CustomerMasterErrorRow[];
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

async function importOneCustomer(companyId: string, row: ParsedCustomerRow, summary: CustomerMasterImportSummary): Promise<void> {
  try {
    const businessCode = row.code.trim().slice(0, 10);

    const existing = await prisma.customer.findUnique({
      where: { companyId_businessCode: { companyId, businessCode } },
    });

    const hasAddress = row.addressRaw.trim().length > 0;

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
      if (Object.keys(patch).length > 0) {
        await prisma.customer.update({ where: { id: existing.id }, data: patch });
      }
      summary.clientesActualizados += 1;
    } else {
      if (!row.name) {
        throw new Error(`Falta el Nombre para dar de alta el cliente con código ${businessCode}`);
      }
      await prisma.customer.create({
        data: {
          companyId,
          businessCode,
          legalName: row.name,
          defaultAddress: hasAddress ? row.address || row.addressRaw : undefined,
          defaultCity: row.city,
          defaultProvince: row.province,
          defaultPostalCode: row.postalCode,
        },
      });
      summary.clientesCreados += 1;
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
    sinCodigoPostalDetectado: [],
    erroresParseo: parseErrors,
    errores: [],
  };

  await runWithConcurrency(customers, IMPORT_CONCURRENCY, (row) => importOneCustomer(companyId, row, summary));

  return summary;
}
