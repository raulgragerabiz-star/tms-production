// Importación del catálogo real de productos (fichero "SURTIDO GETAFE Nuevas
// ventas erp y nav.xlsx" aportado por Raúl) -- deja el maestro de Productos
// con dimensiones de palé reales (donde el catálogo las trae bien formadas),
// categoría/nomenclatura y clasificación ABC de rotación, en vez del único
// producto de demo (`DEMO-0001`) que había hasta ahora.
//
// El fichero original tiene 85 columnas (incluye ventas mensuales ERP/Nav,
// precios, condiciones de compra...) de las que aquí solo se usan las que
// alimentan la ficha de producto del TMS. Los datos ya vienen limpiados y
// normalizados en `prisma/data/surtido-import.json` (generado una sola vez a
// partir del Excel): concretamente, "Medidas Palet" del Excel venía con dos
// convenciones de unidad mezcladas dentro de la misma columna (unas filas en
// metros, ej. "1,2x0,8x0,8", otras en centímetros, ej. "120x80x73,8", pese a
// que el título de la columna dice "cm" para todas) -- se normalizó cada fila
// según la magnitud de sus valores, y se descartaron los pocos casos
// (~2,5%) que ni así daban una medida de palé plausible. De 10.714 filas
// del Excel, 10.634 tienen los datos mínimos (SKU, peso, unidad de venta)
// para crear el producto, y de esas, 2.826 (≈27%) tienen además dimensiones
// de palé fiables -- el resto queda con volumen desconocido hasta que se
// complete a mano desde Backoffice > Productos, exactamente igual que
// cualquier producto sin dimensiones cargadas.
//
// Idempotente: usa upsert por SKU, así se puede volver a ejecutar sin
// duplicar nada (por ejemplo tras corregir algún dato en el Excel de origen).

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

interface ImportRecord {
  sku: string;
  description: string;
  salesUnit: string;
  unitsPerPallet: number;
  grossWeightKg: number;
  fullPalletWeightKg: number;
  active: boolean;
  lengthM?: number;
  widthM?: number;
  heightM?: number;
  category?: string;
  abcClass?: string;
  ean?: string;
}

const CHUNK_SIZE = 50;

async function main() {
  const dataPath = path.join(__dirname, "data", "surtido-import.json");
  const records: ImportRecord[] = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  console.log(`Leídos ${records.length} productos de ${dataPath}`);

  const company = await prisma.company.findFirstOrThrow();
  console.log(`Importando en la empresa: ${company.name} (${company.id})`);

  let created = 0;
  let updated = 0;
  let withDims = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (r) => {
        try {
          const existing = await prisma.product.findUnique({ where: { sku: r.sku } });
          const data = {
            companyId: company.id,
            sku: r.sku,
            description: r.description,
            salesUnit: r.salesUnit,
            unitsPerPallet: r.unitsPerPallet,
            grossWeightKg: r.grossWeightKg,
            fullPalletWeightKg: r.fullPalletWeightKg,
            active: r.active,
            lengthM: r.lengthM ?? null,
            widthM: r.widthM ?? null,
            heightM: r.heightM ?? null,
            category: r.category ?? null,
            abcClass: r.abcClass ?? null,
            ean: r.ean ?? null,
          };
          await prisma.product.upsert({ where: { sku: r.sku }, create: data, update: data });
          if (existing) updated++;
          else created++;
          if (r.lengthM) withDims++;
        } catch (err: any) {
          failed++;
          console.warn(`  ! SKU ${r.sku} no importado: ${err.message}`);
        }
      })
    );
    process.stdout.write(`\rProcesados ${Math.min(i + CHUNK_SIZE, records.length)}/${records.length}...`);
  }

  console.log("\n\nResumen de importación:");
  console.log(`  Creados: ${created}`);
  console.log(`  Actualizados (ya existían por SKU): ${updated}`);
  console.log(`  Con dimensiones de palé reales: ${withDims}`);
  console.log(`  Fallidos: ${failed}`);
}

main()
  .catch((err) => {
    console.error("Error en la importación:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
