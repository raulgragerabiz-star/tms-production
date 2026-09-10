// Fase 8c: backfill de geocodificación para puntos de entrega YA EXISTENTES
// sin lat/lng (creados antes de este arreglo por los tres importadores --
// Excel de pedidos, bridge ERP Claud, maestro de clientes -- que hasta ahora
// nunca llamaban a OpenRouteService). A partir de esta fase todo punto de
// entrega nuevo se geocodifica automáticamente al crearse (ver
// @/modules/delivery-points/delivery-points.service.ts y su uso en esos tres
// importadores); este script solo hace falta ejecutarlo para desatascar el
// histórico ya cargado -- por ejemplo, los pedidos de Getafe que Raúl vio sin
// coordenadas en el Planificador.
//
// Uso (desde backend/):
//   npx tsx src/scripts/geocode-backfill.ts
//
// Es seguro ejecutarlo varias veces: cada vuelta solo toca los puntos que
// SIGAN sin lat/lng (los ya geocodificados, en esta o en una vuelta anterior,
// se ignoran). Respeta la cuota gratuita de ORS Geocoding (1000 peticiones/
// día): procesa de uno en uno con una pequeña pausa entre llamadas, y si ORS
// responde "cuota agotada" (HTTP 429) se detiene ahí mismo -- basta con
// volver a ejecutar el script más tarde (o al día siguiente) para continuar
// con los que falten, sin repetir trabajo ya hecho.
import { prisma } from "@/lib/prisma";
import { geocodeAddress, OrsRequestError } from "@/modules/routing/ors.service";

const DELAY_BETWEEN_REQUESTS_MS = 300;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const pending = await prisma.deliveryPoint.findMany({
    where: { deletedAt: null, lat: null },
    select: {
      id: true,
      address: true,
      city: true,
      province: true,
      postalCode: true,
      country: true,
      customer: { select: { businessCode: true, legalName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Puntos de entrega sin coordenadas encontrados: ${pending.length}`);
  if (pending.length === 0) {
    console.log("Nada que hacer -- todos los puntos de entrega activos ya tienen coordenadas.");
    return;
  }

  let ok = 0;
  let sinResultado = 0;
  let conError = 0;

  for (const dp of pending) {
    const etiqueta = `${dp.customer.businessCode} (${dp.customer.legalName}) - ${dp.address}`;
    try {
      const result = await geocodeAddress({
        address: dp.address,
        postalCode: dp.postalCode ?? undefined,
        city: dp.city ?? undefined,
        province: dp.province ?? undefined,
        country: dp.country ?? undefined,
      });

      if (result) {
        await prisma.deliveryPoint.update({ where: { id: dp.id }, data: { lat: result.lat, lng: result.lng } });
        ok += 1;
        console.log(`OK   ${etiqueta}  ->  ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`);
      } else {
        sinResultado += 1;
        console.log(`--   ${etiqueta}  (ORS no ha encontrado ninguna coincidencia para esta dirección)`);
      }
    } catch (err) {
      conError += 1;
      console.error(`ERROR ${etiqueta}:`, (err as Error)?.message ?? err);
      if (err instanceof OrsRequestError && err.status === 429) {
        console.error(
          "\nCuota diaria de geocodificación de ORS agotada. Se detiene el proceso aquí -- " +
            "vuelve a ejecutar este mismo script más tarde (o mañana) para continuar con los " +
            "puntos que falten; los ya resueltos no se vuelven a procesar."
        );
        break;
      }
    }

    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  const procesados = ok + sinResultado + conError;
  console.log(
    `\nResumen: ${ok} geocodificados, ${sinResultado} sin resultado, ${conError} con error ` +
      `(${procesados} de ${pending.length} pendientes procesados).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fallo inesperado en el backfill de geocodificación:", err);
    process.exit(1);
  });
