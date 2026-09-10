// Fase 8c: geocodificación automática de puntos de entrega creados por
// importaciones masivas (Excel de pedidos, bridge ERP Claud, maestro de
// clientes). Hasta ahora la geocodificación automática (OpenRouteService, ver
// ors.service.ts) solo estaba conectada al alta/edición manual de un punto de
// entrega desde el formulario (delivery-points.routes.ts, geocodeIfMissing) --
// los tres importadores creaban el DeliveryPoint directamente contra Prisma
// sin pasar por ahí, así que nunca llegaban a tener lat/lng aunque la
// dirección estuviera completa. Esta función centraliza el mismo "geocodificar
// si falta" para poder reutilizarlo desde los tres importadores (y desde el
// script de backfill de datos históricos), sin tocar el endpoint manual que
// ya funcionaba.
//
// A propósito recibe solo el id y hace su propia lectura -- así se puede
// llamar SIEMPRE DESPUÉS de que la transacción de creación del pedido/cliente
// ya se ha confirmado, nunca dentro de un `tx`: es una llamada de red a una
// API externa (hasta 8s de timeout, ver REQUEST_TIMEOUT_MS en ors.service.ts)
// y mantener abierta una transacción de base de datos mientras se espera una
// respuesta externa agotaría el pool de conexiones de Postgres en una
// importación de cientos de pedidos.
//
// Es "best effort" por diseño, igual que su equivalente manual: si no hay
// clave ORS configurada, si la dirección no se reconoce o si la llamada
// falla por lo que sea, se deja tal cual (sin coordenadas) exactamente igual
// que pasaba antes de este cambio -- nunca hace fallar una importación.
import { prisma } from "@/lib/prisma";
import { geocodeAddress } from "@/modules/routing/ors.service";

export async function geocodeDeliveryPointIfMissing(deliveryPointId: string): Promise<void> {
  try {
    const dp = await prisma.deliveryPoint.findUnique({ where: { id: deliveryPointId } });
    if (!dp || dp.lat != null || dp.lng != null || !dp.address) return;

    const result = await geocodeAddress({
      address: dp.address,
      postalCode: dp.postalCode ?? undefined,
      city: dp.city ?? undefined,
      province: dp.province ?? undefined,
      country: dp.country ?? undefined,
    });
    if (result) {
      await prisma.deliveryPoint.update({ where: { id: dp.id }, data: { lat: result.lat, lng: result.lng } });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[geocoding] no se pudo geocodificar automáticamente el punto de entrega",
      deliveryPointId,
      ":",
      (err as Error)?.message ?? err
    );
  }
}
