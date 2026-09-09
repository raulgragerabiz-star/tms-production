// Corrige un hueco puntual en los datos de demo (ver comentario en seed.ts,
// bloque `extraCustomers`): los 4 clientes de demo añadidos para poder ver
// varios marcadores reales en el mapa del planificador (BIGMAT STORES /
// Fuenlabrada, FERRETERÍA CENTRAL MADRID, CONSTRUCCIONES PINTO, MATERIALES
// PARLA) se crearon con un punto de entrega SIN código postal. Como la
// consulta pública de pedidos (/seguimiento) exige nº de pedido + código
// postal para localizar el pedido, cualquier pedido de prueba creado contra
// uno de estos 4 clientes (ej. los pedidos "DEMO-...") no se puede consultar
// ahí -- no es un fallo de la consulta en sí, es que a ese punto de entrega
// le falta el dato.
//
// Este script NO crea nada nuevo ni toca ningún otro dato: solo recorre esos
// 4 códigos de cliente y, si su punto de entrega ya existe y tiene el código
// postal vacío, se lo rellena con el mismo valor que ya lleva el seed
// corregido. Idempotente -- se puede ejecutar tantas veces como haga falta,
// no vuelve a tocar un punto de entrega que ya tenga código postal (por si
// alguien ya se lo puso a mano desde la API).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FIXES: { code: string; postalCode: string }[] = [
  { code: "500010", postalCode: "28942" }, // BIGMAT STORES, S.L.U -- Fuenlabrada
  { code: "500011", postalCode: "28021" }, // FERRETERÍA CENTRAL MADRID, S.L. -- Madrid
  { code: "500012", postalCode: "28320" }, // CONSTRUCCIONES PINTO, S.A. -- Pinto
  { code: "500013", postalCode: "28981" }, // MATERIALES PARLA, S.L. -- Parla
];

async function main() {
  let updated = 0;
  let alreadyOk = 0;
  let notFound = 0;

  for (const fix of FIXES) {
    const customer = await prisma.customer.findFirst({ where: { businessCode: fix.code } });
    if (!customer) {
      notFound++;
      console.log(`  - Cliente ${fix.code}: no existe en esta base de datos, se omite.`);
      continue;
    }

    const deliveryPoints = await prisma.deliveryPoint.findMany({ where: { customerId: customer.id } });
    if (deliveryPoints.length === 0) {
      notFound++;
      console.log(`  - Cliente ${fix.code}: no tiene ningún punto de entrega, se omite.`);
      continue;
    }

    for (const dp of deliveryPoints) {
      if (dp.postalCode) {
        alreadyOk++;
        continue;
      }
      await prisma.deliveryPoint.update({ where: { id: dp.id }, data: { postalCode: fix.postalCode } });
      updated++;
      console.log(`  - Cliente ${fix.code}: código postal ${fix.postalCode} añadido a su punto de entrega.`);
    }
  }

  console.log("\nResumen:");
  console.log(`  Actualizados: ${updated}`);
  console.log(`  Ya tenían código postal (sin tocar): ${alreadyOk}`);
  console.log(`  No encontrados en esta base de datos: ${notFound}`);
}

main()
  .catch((err) => {
    console.error("Error en el backfill:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
