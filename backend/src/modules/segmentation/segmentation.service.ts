import { PrismaClient, Prisma, ServiceType } from "@prisma/client";
import { getOrLoad, invalidate } from "@/lib/memory-cache";

export interface SegmentationRuleInput {
  segment: ServiceType;
  maxWeightKg: number | null;
  maxPallets: number | null;
  maxWeightPerPalletKg: number | null;
  priority: number;
}

export interface OrderAggregates {
  totalWeightKg: number;
  totalPallets: number;
  maxWeightPerPalletKg?: number; // peso del palé más pesado del pedido, si aplica
}

/**
 * Clasificación de segmento — función pura, sin efectos secundarios.
 * La primera regla (ordenada por priority) que cumple TODOS los límites
 * definidos (los NULL se ignoran, "sin límite") gana. Fallback: gran_volumen
 * si ninguna regla matchea.
 *
 * NOTA: a diferencia del borrador original, esta versión NO evalúa volumen
 * (maxVolumeM3) porque `OrderLine` todavía no tiene una columna de volumen
 * real (ver docs/09-motor-optimizacion-TMS.md: "volumen preparado pero
 * inactivo hasta tener dimensiones de palé"). Si en el futuro se activa esa
 * columna, se reintroduce aquí sin tocar la firma pública.
 */
export function classifyServiceSegment(order: OrderAggregates, rules: SegmentationRuleInput[]): ServiceType {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  for (const r of sorted) {
    const okWeight = r.maxWeightKg == null || order.totalWeightKg <= r.maxWeightKg;
    const okPallets = r.maxPallets == null || order.totalPallets <= r.maxPallets;
    const okWeightPerPallet =
      r.maxWeightPerPalletKg == null ||
      order.maxWeightPerPalletKg == null ||
      order.maxWeightPerPalletKg <= r.maxWeightPerPalletKg;

    if (okWeight && okPallets && okWeightPerPallet) {
      return r.segment;
    }
  }

  return ServiceType.gran_volumen;
}

/**
 * Días hábiles entre dos fechas (lunes-viernes, sin festivos por ahora — el
 * calendario de festivos ya existe para el suplemento de tarifas y se podría
 * reutilizar aquí en una iteración posterior si se requiere precisión festiva
 * en el lead time).
 */
export function diasHabiles(from: Date, to: Date): number {
  if (to <= from) return 0;
  let count = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/**
 * Reglas activas de segmentación de una empresa, cacheadas 5 minutos.
 * OPTIMIZACIÓN: sin este cache, un import de erpclaud de N pedidos lanzaría
 * N SELECT idénticos contra `service_segmentation_rule` (una por pedido); con
 * el cache, solo la primera petición del lote toca BD. Las reglas cambian con
 * muy poca frecuencia (configuración, no operación diaria), por eso un TTL de
 * 5 minutos es seguro.
 */
const RULES_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getActiveSegmentationRules(prisma: PrismaClient, companyId: string) {
  return getOrLoad(`segmentation-rules:${companyId}`, RULES_CACHE_TTL_MS, () =>
    prisma.serviceSegmentationRule.findMany({ where: { companyId, active: true } })
  );
}

/** Invalidar tras crear/editar/desactivar una regla desde el backoffice. */
export function invalidateSegmentationRulesCache(companyId: string) {
  invalidate(`segmentation-rules:${companyId}`);
}

type SegmentationRuleRow = Awaited<ReturnType<typeof getActiveSegmentationRules>>[number];

/**
 * Carga las reglas activas de una empresa y calcula el segmento + leadTimeDays
 * para un pedido ya persistido. Se invoca al crear/actualizar un Order (bridge
 * ERP, alta manual) y bajo demanda desde el Planificador.
 *
 * Acepta `tx` en vez de `prisma` directamente para poder ejecutarse dentro de
 * la misma transacción que crea el pedido/sus líneas (ver erpclaud.service.ts).
 *
 * OPTIMIZACIÓN: acepta `preloadedRules` opcional para que un caller que ya
 * procesa varios pedidos en el mismo lote pueda cargar las reglas UNA vez
 * fuera del bucle y pasarlas aquí.
 */
export async function classifyOrder(
  tx: Prisma.TransactionClient,
  companyId: string,
  orderId: string,
  preloadedRules?: SegmentationRuleRow[]
): Promise<{ segment: ServiceType; leadTimeDays: number; suggestedUrgent: boolean }> {
  const rules =
    preloadedRules ?? (await tx.serviceSegmentationRule.findMany({ where: { companyId, active: true } }));

  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true,
      createdAt: true,
      requestedDeliveryDate: true,
      priority: true,
      lines: {
        select: {
          quantity: true,
          lineWeightKg: true,
          product: { select: { unitsPerPallet: true, fullPalletWeightKg: true } },
        },
      },
    },
  });

  let totalWeightKg = 0;
  let totalPallets = 0;
  let maxWeightPerPalletKg = 0;

  for (const line of order.lines) {
    const weight = Number(line.lineWeightKg ?? 0);
    totalWeightKg += weight;

    const unitsPerPallet = line.product.unitsPerPallet ?? 1;
    const palletsForLine = unitsPerPallet > 0 ? Number(line.quantity) / unitsPerPallet : 0;
    totalPallets += palletsForLine;

    const fullPalletWeight = Number(line.product.fullPalletWeightKg ?? 0);
    if (fullPalletWeight > maxWeightPerPalletKg) maxWeightPerPalletKg = fullPalletWeight;
  }

  const segment = classifyServiceSegment(
    { totalWeightKg, totalPallets, maxWeightPerPalletKg },
    rules.map((r) => ({
      segment: r.segment,
      maxWeightKg: r.maxWeightKg ? Number(r.maxWeightKg) : null,
      maxPallets: r.maxPallets ?? null,
      maxWeightPerPalletKg: r.maxWeightPerPalletKg ? Number(r.maxWeightPerPalletKg) : null,
      priority: r.priority,
    }))
  );

  const leadTimeDays = diasHabiles(order.createdAt, order.requestedDeliveryDate);
  const suggestedUrgent = leadTimeDays <= 1;

  await tx.order.update({ where: { id: orderId }, data: { serviceType: segment } });

  return { segment, leadTimeDays, suggestedUrgent };
}
