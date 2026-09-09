// Diagnóstico + arreglo puntual para un pedido concreto que no se puede
// consultar en /seguimiento porque su punto de entrega no tiene código
// postal (o Raúl no sabe cuál es).
//
// Motivo de este script: el backfill de los 4 clientes de demo del seed
// (`backfill-demo-postal-codes.ts`) solo cubre esos 4 -- si un pedido de
// prueba se creó contra OTRO cliente que también tuviera su punto de
// entrega sin código postal (por ejemplo, un cliente creado a mano en algún
// momento anterior a que se exigiera código postal en todas las vías de
// alta), ese backfill no lo toca. Este script, en cambio, va directo al
// pedido por su número, así no hace falta saber de antemano qué cliente es
// ni tocar la base de datos a mano.
//
// Uso (desde backend/):
//   npm run db:fix-order-cp -- <numero-de-pedido>                  -> solo diagnostica, no cambia nada
//   npm run db:fix-order-cp -- <numero-de-pedido> <codigo-postal>  -> además, rellena el código postal si estaba vacío
//
// Ejemplos:
//   npm run db:fix-order-cp -- DEMO-1788524290382
//   npm run db:fix-order-cp -- DEMO-1788524290382 28906
//
// No toca nada si el punto de entrega YA tiene código postal -- para
// cambiar uno ya existente, hazlo a propósito editando el punto de entrega,
// no con este script (pensado solo para rellenar un hueco, no para
// sobrescribir un dato ya cargado).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [orderNumberArg, postalCodeArg] = process.argv.slice(2);

  if (!orderNumberArg) {
    console.error(
      "Falta el número de pedido.\n\n" +
        "Uso:\n" +
        "  npm run db:fix-order-cp -- <numero-de-pedido>\n" +
        "  npm run db:fix-order-cp -- <numero-de-pedido> <codigo-postal>"
    );
    process.exitCode = 1;
    return;
  }

  const order = await prisma.order.findFirst({
    where: { orderNumber: { equals: orderNumberArg.trim(), mode: "insensitive" } },
    include: {
      customer: { select: { businessCode: true, legalName: true } },
      deliveryPoint: true,
    },
  });

  if (!order) {
    console.error(
      `No existe ningún pedido con el número "${orderNumberArg}" en esta base de datos.\n` +
        "Revisa que no tenga espacios de más, y que estés apuntando a la misma base de " +
        "datos (Neon) donde se creó el pedido -- Codespaces y Cloud Run comparten la " +
        "misma DATABASE_URL, así que no debería ser un problema de entorno distinto, " +
        "pero conviene descartarlo si el pedido se creó hace tiempo."
    );
    process.exitCode = 1;
    return;
  }

  const dp = order.deliveryPoint;
  console.log(`Pedido encontrado: ${order.orderNumber} (id ${order.id})`);
  console.log(`  Cliente: ${order.customer.businessCode} — ${order.customer.legalName}`);
  console.log(`  Punto de entrega: ${dp.id}`);
  console.log(`  Dirección: ${dp.address}`);
  console.log(`  Población: ${dp.city ?? "(sin población)"}`);
  console.log(`  Provincia: ${dp.province ?? "(sin provincia)"}`);
  console.log(`  Código postal actual: ${dp.postalCode ?? "(VACÍO -- por esto falla /seguimiento)"}`);

  if (dp.postalCode) {
    console.log(
      "\nEste punto de entrega YA tiene código postal -- si la consulta en /seguimiento " +
        `sigue fallando, prueba exactamente con "${dp.postalCode}" (tal cual, sin espacios).`
    );
    return;
  }

  if (!postalCodeArg) {
    console.log(
      "\nNo se ha indicado un código postal para rellenar. Vuelve a ejecutar así para " +
        "arreglarlo:\n" +
        `  npm run db:fix-order-cp -- "${order.orderNumber}" <codigo-postal>`
    );
    return;
  }

  await prisma.deliveryPoint.update({
    where: { id: dp.id },
    data: { postalCode: postalCodeArg.trim() },
  });

  console.log(
    `\nOK: código postal "${postalCodeArg.trim()}" guardado en el punto de entrega de este pedido. ` +
      `Ya puedes consultar "${order.orderNumber}" en /seguimiento con ese código postal.`
  );
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
