// Fase 16: alta/edición manual de la dirección de entrega por defecto de un
// cliente desde la ficha (NewCustomerModal) -- petición explícita de Raúl:
// "en la pestaña socios, a la hora de editar no me permite indicar todos los
// datos. debe dar opcion a direccion y cp, para que extraiga las coordenadas
// de cara al mapa de ubicacion. tanto en la edicion como en la creacion".
//
// Hasta ahora Customer.defaultAddress/defaultCity/defaultProvince/
// defaultPostalCode (y el DeliveryPoint real con lat/lng que alimenta el
// mapa de Inicio, ver dashboard.routes.ts /clients-map) solo se podían
// cargar importando el maestro de clientes en Excel (ver
// customer-master-import.service.ts) -- el formulario de alta/edición manual
// (customers.routes.ts) no tocaba ninguno de los dos, así que un cliente
// dado de alta o editado a mano se quedaba siempre sin geolocalizar.
//
// Distinto del `ensureDeliveryPoint` del importador: aquella función es
// idempotente por dirección EXACTA (para no duplicar puntos al reimportar el
// mismo Excel varias veces, donde cada fila trae siempre el mismo texto).
// Aquí, en cambio, hay como mucho UN punto de entrega "por defecto" por
// cliente gestionado desde este formulario (el más antiguo activo): si se
// edita la dirección de un cliente que ya tenía una, se ACTUALIZA ese mismo
// punto -- y se limpian sus coordenadas si el texto cambió, para forzar una
// nueva geocodificación -- en vez de crear uno nuevo cada vez que se corrige
// una errata.
import { prisma } from "@/lib/prisma";
import { geocodeDeliveryPointIfMissing } from "@/modules/delivery-points/delivery-points.service";

export interface DefaultAddressInput {
  address: string;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
}

export async function upsertDefaultDeliveryPoint(customerId: string, addr: DefaultAddressInput): Promise<void> {
  const address = addr.address.trim();
  if (!address) return; // Sin dirección no hay nada que geolocalizar.

  const primary = await prisma.deliveryPoint.findFirst({
    where: { customerId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  const postalCode = addr.postalCode?.trim() || null;
  const city = addr.city?.trim() || null;
  const province = addr.province?.trim() || null;

  let deliveryPointId: string;
  if (primary) {
    const addressChanged =
      primary.address.trim().toLowerCase() !== address.toLowerCase() || (primary.postalCode ?? null) !== postalCode;
    await prisma.deliveryPoint.update({
      where: { id: primary.id },
      data: {
        address,
        postalCode,
        city,
        province,
        // Si ha cambiado la dirección o el CP, las coordenadas ya guardadas
        // corresponden a la dirección VIEJA -- se limpian para que
        // geocodeDeliveryPointIfMissing las recalcule. Si no ha cambiado
        // nada, se dejan tal cual (evita una llamada de red innecesaria cada
        // vez que se abre y se guarda el formulario sin tocar la dirección).
        ...(addressChanged ? { lat: null, lng: null } : {}),
      },
    });
    deliveryPointId = primary.id;
  } else {
    const created = await prisma.deliveryPoint.create({
      data: {
        customerId,
        address,
        postalCode: postalCode ?? undefined,
        city: city ?? undefined,
        province: province ?? undefined,
        country: "ES",
      },
    });
    deliveryPointId = created.id;
  }

  await geocodeDeliveryPointIfMissing(deliveryPointId);
}
