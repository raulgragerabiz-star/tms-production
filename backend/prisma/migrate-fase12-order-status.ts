// Fase 12: petición de Raúl -- ningún proceso de la app pasa nunca un pedido
// de "Recibido" a "Validado" a mano (ese botón no existía en ningún sitio),
// así que tener los dos como estados distintos solo dejaba pedidos antiguos
// colgados en "Recibido" para siempre, sin ninguna forma de que aparecieran
// como disponibles para planificar. A partir de ahora todo pedido nace ya
// "Validado" (`schema.prisma`, valor por defecto) -- este script solo
// corrige los pedidos que ya existieran en base de datos, creados antes de
// este cambio, y que sigan en "Recibido".
//
// Idempotente -- se puede ejecutar tantas veces como haga falta, la segunda
// vez no encuentra ningún pedido en "received" y no toca nada.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.order.updateMany({
    where: { status: "received" as any },
    data: { status: "validated" as any },
  });

  console.log(`Pedidos migrados de "Recibido" a "Validado": ${result.count}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
