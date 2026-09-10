// Fase 8: importación de la plantilla real de circuitos/transportistas/tarifas
// que aportó Raúl (Excel de dos pestañas). Uso:
//
//   npx tsx src/scripts/import-fase8-zonas-tarifas.ts /ruta/al/excel.xlsx
//
// Requiere que el schema ya esté migrado en la base de datos de destino
// (`npx prisma db push` o `migrate deploy` con los modelos DeliveryZone /
// DeliveryZoneRate / CarrierVehicleType nuevos) -- este script NO migra
// nada, solo inserta datos.
//
// Qué hace cada pestaña de la plantilla:
//
//  - "Hoja1" (cod, cliente, direccion, ruta): el listado de clientes que
//    aportó Raúl para "revisar con los ya integrados" -- se usa aquí solo
//    como CHEQUEO CRUZADO de cobertura (cuántos de estos 106 clientes
//    encuentran su circuito real en Hoja2, y cuáles no), no como fuente de
//    la asignación en sí, porque su columna "ruta" usa una nomenclatura más
//    amplia ("ASTURIAS (Pinto)", "EXTREMADURA (Pinto)"...) que no coincide
//    1:1 con los circuitos operativos de Hoja2 (p.ej. "EXTREMADURA (Pinto)"
//    de Hoja1 se reparte entre "EXTREMADURA 1" y "EXTREMADURA 2" de Hoja2) --
//    inventar esa correspondencia sería adivinar datos que no tenemos.
//
//  - "Hoja2" (Centro Logístico, Rutas, Circuito, ..., Cod. Socio, Socios, ...,
//    Prov. De Tte, €, €/Tn, Descarga, Últ. Tarifa, Ingreso €/tn socios): los
//    datos operativos reales -- cada fila es un cliente concreto, servido
//    por un circuito ("Rutas": MAD1, MAD2, EXTREMADURA 1...) a través de un
//    transportista concreto ("Prov. De Tte"), con su tarifa. Esta es la
//    fuente que SÍ se usa para la asignación cliente→circuito (104 de los
//    106 clientes de Hoja1 aparecen aquí, sin ambigüedad: cada código de
//    cliente cae bajo un único circuito) y para dar de alta los circuitos
//    (DeliveryZone) y las tarifas por transportista (DeliveryZoneRate).
//
// Varias columnas de Hoja2 (Centro Logístico, Rutas, Circuito) solo llevan
// valor en la primera fila de cada grupo -- como una tabla dinámica exportada
// a Excel -- así que se "arrastran hacia abajo" (forward-fill) antes de
// procesar cada fila.
//
// La columna "Prov. De Tte" trae mezcladas, además de nombres reales de
// transportista, unas pocas filas de resumen/fórmula rota de la propia
// plantilla (medias, "#REF!", el texto "Paradas" repetido de la cabecera,
// un número de teléfono suelto) -- se descartan con un filtro explícito,
// nunca por adivinar un patrón; ver CARRIER_DENYLIST más abajo, contrastado
// fila a fila contra el fichero real antes de escribir este script.
//
// Idempotente: si ya existe una tarifa para un (circuito, transportista),
// no se duplica en una segunda ejecución.
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import * as fs from "node:fs";
import * as path from "node:path";

const prisma = new PrismaClient();

// Tokens conocidos de la columna "Prov. De Tte" que NO son transportistas
// (filas de resumen/fórmula de la propia plantilla de origen), confirmados
// inspeccionando el fichero real fila a fila -- no es una heurística de
// patrón, es la lista exacta encontrada.
const CARRIER_DENYLIST = new Set(
  ["€/tn transp.", "desc. adicional", "media ingreso €/tn centr. log.", "paradas"].map((s) => s.toLowerCase())
);

function isValidCarrierToken(raw: unknown): raw is string {
  if (raw == null) return false;
  const s = String(raw).trim();
  if (s.length < 2) return false;
  if (/^\d+$/.test(s)) return false; // números sueltos (p.ej. un teléfono mal pegado)
  if (CARRIER_DENYLIST.has(s.toLowerCase())) return false;
  return true;
}

function normalizeHeader(h: unknown): string {
  return String(h ?? "").trim().toLowerCase();
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

interface ZoneRateGroupRow {
  flatFee: number | null;
  pricePerTon: number | null;
  unloadFee: number | null;
  partnerIncomePerTon: number | null;
  scheduleNote: string | null;
  validFrom: Date | null;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Uso: npx tsx src/scripts/import-fase8-zonas-tarifas.ts /ruta/al/excel.xlsx");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`No existe el fichero: ${filePath}`);
    process.exit(1);
  }

  const company = await prisma.company.findFirstOrThrow();
  console.log(`Importando en la empresa: ${company.name} (${company.id})`);

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet1 = workbook.Sheets["Hoja1"];
  const sheet2 = workbook.Sheets["Hoja2"];
  if (!sheet1 || !sheet2) {
    console.error('El fichero debe tener las pestañas "Hoja1" y "Hoja2"');
    process.exit(1);
  }

  const rows1: unknown[][] = XLSX.utils.sheet_to_json(sheet1, { header: 1, raw: true, defval: null });
  const rows2: unknown[][] = XLSX.utils.sheet_to_json(sheet2, { header: 1, raw: true, defval: null });

  const header2 = rows2[0].map(normalizeHeader);
  const col = (name: string) => {
    const idx = header2.indexOf(name.toLowerCase());
    if (idx === -1) throw new Error(`No se encontró la columna "${name}" en Hoja2 (cabecera: ${rows2[0].join(" | ")})`);
    return idx;
  };
  const COL_CENTRO = col("Centro Logístico");
  const COL_RUTAS = col("Rutas");
  const COL_COD_SOCIO = col("Cod. Socio");
  const COL_SOCIOS = col("Socios");
  const COL_CUADERNO = col("Cuaderno de Servicio");
  const COL_PROV_TTE = col("Prov. De Tte");
  const COL_EUR = col("€");
  const COL_EUR_TN = col("€/Tn");
  const COL_DESCARGA = col("Descarga");
  const COL_ULT_TARIFA = col("Últ. Tarifa");
  const COL_INGRESO_SOCIOS = col("Ingreso €/tn socios");

  // Posible almacén "Getafe" para vincular los circuitos, si existe --
  // opcional, un circuito sin almacén sigue funcionando igual.
  const warehouses = await prisma.warehouse.findMany({ where: { companyId: company.id } });
  const centroValue = String(rows2[1]?.[COL_CENTRO] ?? "").trim().toLowerCase();
  const matchedWarehouse = warehouses.find((w) => w.name.toLowerCase().includes(centroValue) || centroValue.includes(w.name.toLowerCase()));

  // ---- 1) Forward-fill de Hoja2 y agrupación por (circuito, transportista) ----
  const zoneCache = new Map<string, string>(); // nombre normalizado -> id
  const carrierCache = new Map<string, string>(); // nombre normalizado -> id
  const groups = new Map<string, { zoneName: string; carrierName: string; customers: Set<string>; rows: ZoneRateGroupRow[] }>();
  const skippedCarrierRows: { row: number; value: unknown }[] = [];

  let lastRuta: string | null = null;
  for (let i = 1; i < rows2.length; i++) {
    const row = rows2[i];
    if (!row || row.every((c) => c === null)) continue;
    const rutaCell = row[COL_RUTAS];
    if (rutaCell !== null && rutaCell !== 0 && String(rutaCell).trim() !== "") {
      lastRuta = String(rutaCell).trim();
    }
    const zoneName = lastRuta;
    const carrierRaw = row[COL_PROV_TTE];
    const codSocio = row[COL_COD_SOCIO];

    if (!zoneName) continue;
    if (!isValidCarrierToken(carrierRaw)) {
      if (carrierRaw !== null) skippedCarrierRows.push({ row: i + 1, value: carrierRaw });
      continue;
    }
    const carrierName = String(carrierRaw).trim();

    const key = `${zoneName.toLowerCase()}::${carrierName.toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, { zoneName, carrierName, customers: new Set(), rows: [] });
    }
    const group = groups.get(key)!;
    if (codSocio !== null) group.customers.add(String(codSocio).trim());

    const ultTarifaCell = row[COL_ULT_TARIFA];
    const validFrom = ultTarifaCell instanceof Date ? ultTarifaCell : null;
    group.rows.push({
      flatFee: toNumberOrNull(row[COL_EUR]),
      pricePerTon: toNumberOrNull(row[COL_EUR_TN]),
      unloadFee: toNumberOrNull(row[COL_DESCARGA]),
      partnerIncomePerTon: toNumberOrNull(row[COL_INGRESO_SOCIOS]),
      scheduleNote: row[COL_CUADERNO] != null ? String(row[COL_CUADERNO]).trim() : null,
      validFrom,
    });
  }

  console.log(`\nGrupos (circuito, transportista) detectados en Hoja2: ${groups.size}`);
  console.log(`Filas descartadas en "Prov. De Tte" (resumen/fórmula, no transportista): ${skippedCarrierRows.length}`);

  // ---- 2) Alta de circuitos (DeliveryZone) y transportistas (Carrier) ----
  const existingCarriers = await prisma.carrier.findMany({ where: { companyId: company.id } });
  const existingTaxIds = new Set(existingCarriers.map((c) => c.taxId));
  const carriersCreated: { legalName: string; taxId: string }[] = [];
  const zonesCreated: string[] = [];
  const inconsistentGroups: { zone: string; carrier: string; campo: string; valores: (number | null)[] }[] = [];
  let ratesCreated = 0;
  let ratesAlreadyExisted = 0;

  async function ensureZone(name: string): Promise<string> {
    const key = name.toLowerCase();
    if (zoneCache.has(key)) return zoneCache.get(key)!;
    const zone = await prisma.deliveryZone.upsert({
      where: { companyId_name: { companyId: company.id, name } },
      update: {},
      create: { companyId: company.id, name, warehouseId: matchedWarehouse?.id ?? null },
    });
    if (zone.createdAt.getTime() === zone.updatedAt.getTime()) zonesCreated.push(name);
    zoneCache.set(key, zone.id);
    return zone.id;
  }

  async function ensureCarrier(name: string): Promise<string> {
    const key = name.toLowerCase();
    if (carrierCache.has(key)) return carrierCache.get(key)!;
    const found = existingCarriers.find((c) => c.legalName.toLowerCase() === key);
    if (found) {
      carrierCache.set(key, found.id);
      return found.id;
    }
    let taxId = `PENDIENTE-${slugify(name)}`;
    let suffix = 1;
    while (existingTaxIds.has(taxId)) {
      taxId = `PENDIENTE-${slugify(name)}-${suffix++}`;
    }
    existingTaxIds.add(taxId);
    const carrier = await prisma.carrier.create({
      data: {
        companyId: company.id,
        legalName: name,
        taxId,
        notes: "NIF pendiente de confirmar -- alta automática Fase 8 (importación de plantilla de circuitos/tarifas). Completar el NIF real en cuanto se tenga.",
      },
    });
    carriersCreated.push({ legalName: name, taxId });
    carrierCache.set(key, carrier.id);
    return carrier.id;
  }

  function pickRepresentative(rows: ZoneRateGroupRow[]): ZoneRateGroupRow {
    const fields: (keyof ZoneRateGroupRow)[] = ["flatFee", "pricePerTon", "unloadFee", "partnerIncomePerTon"];
    const rep: ZoneRateGroupRow = { flatFee: null, pricePerTon: null, unloadFee: null, partnerIncomePerTon: null, scheduleNote: null, validFrom: null };
    for (const field of fields) {
      const values = rows.map((r) => r[field]).filter((v) => v !== null) as number[];
      if (values.length > 0) (rep as any)[field] = values[0];
    }
    rep.scheduleNote = rows.find((r) => r.scheduleNote)?.scheduleNote ?? null;
    rep.validFrom = rows.find((r) => r.validFrom)?.validFrom ?? null;
    return rep;
  }

  for (const group of groups.values()) {
    const zoneId = await ensureZone(group.zoneName);
    const carrierId = await ensureCarrier(group.carrierName);

    // Aviso (no bloqueante) si dentro del mismo (circuito, transportista) hay
    // valores de tarifa distintos entre filas de cliente -- se usa el primer
    // valor no nulo encontrado como representativo y se deja constancia para
    // que Raúl lo revise, en vez de adivinar cuál es el correcto.
    const fields: (keyof ZoneRateGroupRow)[] = ["flatFee", "pricePerTon", "unloadFee", "partnerIncomePerTon"];
    for (const field of fields) {
      const distinct = new Set(group.rows.map((r) => r[field]).filter((v) => v !== null));
      if (distinct.size > 1) {
        inconsistentGroups.push({ zone: group.zoneName, carrier: group.carrierName, campo: field, valores: Array.from(distinct) as number[] });
      }
    }

    const already = await prisma.deliveryZoneRate.findFirst({ where: { deliveryZoneId: zoneId, carrierId } });
    if (already) {
      ratesAlreadyExisted++;
      continue;
    }

    const rep = pickRepresentative(group.rows);
    await prisma.deliveryZoneRate.create({
      data: {
        deliveryZoneId: zoneId,
        carrierId,
        validFrom: rep.validFrom ?? new Date(),
        flatFee: rep.flatFee,
        pricePerTon: rep.pricePerTon,
        unloadFee: rep.unloadFee,
        partnerIncomePerTon: rep.partnerIncomePerTon,
        scheduleNote: rep.scheduleNote,
      },
    });
    ratesCreated++;
  }

  // ---- 3) Asignación cliente -> circuito, usando Hoja2 (sin ambigüedad) ----
  const customerToZone = new Map<string, string>(); // businessCode -> zoneName
  for (const group of groups.values()) {
    for (const code of group.customers) customerToZone.set(code, group.zoneName);
  }

  let customersAssigned = 0;
  let customersAlreadyOnZone = 0;
  const customersNotFoundInDb: string[] = [];
  for (const [businessCode, zoneName] of customerToZone) {
    const customer = await prisma.customer.findFirst({ where: { companyId: company.id, businessCode } });
    if (!customer) {
      customersNotFoundInDb.push(businessCode);
      continue;
    }
    const zoneId = zoneCache.get(zoneName.toLowerCase());
    if (!zoneId) continue;
    if (customer.deliveryZoneId === zoneId) {
      customersAlreadyOnZone++;
      continue;
    }
    await prisma.customer.update({ where: { id: customer.id }, data: { deliveryZoneId: zoneId } });
    customersAssigned++;
  }

  // ---- 4) Chequeo cruzado contra Hoja1 (solo informativo, no escribe nada) ----
  const header1 = rows1[0].map(normalizeHeader);
  const c1Cod = header1.indexOf("cod");
  const c1Cliente = header1.indexOf("cliente");
  const hoja1Codes: { cod: string; cliente: string }[] = [];
  for (let i = 1; i < rows1.length; i++) {
    const row = rows1[i];
    if (!row || row[c1Cod] == null) continue;
    hoja1Codes.push({ cod: String(row[c1Cod]).trim(), cliente: String(row[c1Cliente] ?? "").trim() });
  }
  const coveredByHoja2 = hoja1Codes.filter((r) => customerToZone.has(r.cod));
  const notCoveredByHoja2 = hoja1Codes.filter((r) => !customerToZone.has(r.cod));

  // ---- 5) Informe ----
  const report = {
    empresa: { id: company.id, nombre: company.name },
    circuitos: { total: zoneCache.size, creados: zonesCreated },
    transportistas: { creados: carriersCreated },
    filasProvTteDescartadas: skippedCarrierRows,
    gruposConTarifaInconsistente: inconsistentGroups,
    tarifas: { creadas: ratesCreated, yaExistian: ratesAlreadyExisted },
    clientes: {
      asignadosAhora: customersAssigned,
      yaEstabanEnEsaZona: customersAlreadyOnZone,
      codigosSinClienteEnBD: customersNotFoundInDb,
    },
    chequeoCruzadoHoja1: {
      totalHoja1: hoja1Codes.length,
      cubiertosPorHoja2: coveredByHoja2.length,
      noEncontradosEnHoja2: notCoveredByHoja2,
    },
  };

  const reportPath = path.join(__dirname, "..", "..", "prisma", "data", "fase8-import-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  console.log("\n===== RESUMEN IMPORTACIÓN FASE 8 =====");
  console.log(`Circuitos totales: ${zoneCache.size} (nuevos: ${zonesCreated.length}: ${zonesCreated.join(", ") || "—"})`);
  console.log(`Transportistas creados: ${carriersCreated.length}`);
  for (const c of carriersCreated) console.log(`   - ${c.legalName}  (NIF provisional: ${c.taxId} -- PENDIENTE DE CONFIRMAR)`);
  console.log(`Tarifas creadas: ${ratesCreated} (ya existían de una ejecución anterior: ${ratesAlreadyExisted})`);
  console.log(`Grupos con valores de tarifa inconsistentes entre filas (revisar manualmente): ${inconsistentGroups.length}`);
  for (const g of inconsistentGroups) console.log(`   - ${g.zone} / ${g.carrier} / ${g.campo}: ${g.valores.join(", ")}`);
  console.log(`Clientes asignados a un circuito ahora: ${customersAssigned} (ya lo estaban: ${customersAlreadyOnZone})`);
  if (customersNotFoundInDb.length > 0) {
    console.log(`Códigos de Hoja2 sin cliente en la base de datos (${customersNotFoundInDb.length}): ${customersNotFoundInDb.join(", ")}`);
  }
  if (notCoveredByHoja2.length > 0) {
    console.log(`\nClientes de Hoja1 SIN circuito asignado (no aparecen en Hoja2, ${notCoveredByHoja2.length}):`);
    for (const r of notCoveredByHoja2) console.log(`   - ${r.cod}  ${r.cliente}`);
  }
  console.log(
    "\nNOTA: si 'Diego Hernandez Gonzalez' es un transportista de prueba en tu base de datos, este script NO lo ha tocado " +
      "a propósito -- la plantilla real trae un transportista genuino llamado 'Diego Hernández' (Extremadura) y no queríamos " +
      "arriesgarnos a confundirlos por nombre. Si el de prueba sigue ahí, dalo de baja a mano desde Transportistas."
  );
  console.log(`\nInforme completo guardado en: ${reportPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
