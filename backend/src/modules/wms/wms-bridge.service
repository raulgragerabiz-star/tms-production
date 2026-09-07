import { Prisma } from "@prisma/client";

/**
 * Versión mínima real (no mock) de la función que erpclaud.service.ts
 * espera reutilizar de un "motor de matching/MDM" más completo
 * (motor-matching-survivorship.md, mencionado en el diseño original pero
 * no presente en este repo). Esta versión resuelve el caso común:
 * matching exacto por (companyId, businessCode) + creación de
 * DeliveryPoint si el cliente existe pero llega una dirección nueva.
 *
 * NO implementa: fuzzy matching de razón social, resolución de
 * duplicados, ni survivorship entre fuentes — eso es una ampliación
 * futura documentada, no bloqueante para tener el flujo end-to-end
 * funcionando ahora.
 */

export interface ResolveCustomerInput {
  sourceSystem: string;
  externalCode: string;
  legalName: string;
  taxId?: string;
  address: {
    address: string;
    city: string;
    province: string;
    postalCode: string;
    lat?: number;
    lng?: number;
  };
}

export interface ResolveCustomerResult {
  customer: { id: string };
  deliveryPoint: { id: string };
  created: boolean;
}

export async function resolveOrCreateCustomer(
  tx: Prisma.TransactionClient,
  companyId: string,
  input: ResolveCustomerInput
): Promise<ResolveCustomerResult> {
  let customer = await tx.customer.findUnique({
    where: { companyId_businessCode: { companyId, businessCode: input.externalCode } },
  });

  let created = false;

  if (!customer) {
    customer = await tx.customer.create({
      data: {
        companyId,
        businessCode: input.externalCode,
        legalName: input.legalName,
        commercialName: input.legalName,
        taxId: input.taxId,
        active: true,
      },
    });
    created = true;
  }

  // Busca un DeliveryPoint ya existente con la misma dirección exacta
  // (evita crear duplicados si el ERP reenvía el mismo pedido varias
  // veces con la misma dirección); si no existe, lo crea.
  let deliveryPoint = await tx.deliveryPoint.findFirst({
    where: {
      customerId: customer.id,
      address: input.address.address,
      postalCode: input.address.postalCode,
    },
  });

  if (!deliveryPoint) {
    deliveryPoint = await tx.deliveryPoint.create({
      data: {
        customerId: customer.id,
        label: input.legalName,
        address: input.address.address,
        postalCode: input.address.postalCode,
        city: input.address.city,
        province: input.address.province,
        country: "ES",
        lat: input.address.lat,
        lng: input.address.lng,
        active: true,
      },
    });
  }

  return {
    customer: { id: customer.id },
    deliveryPoint: { id: deliveryPoint.id },
    created,
  };
}
