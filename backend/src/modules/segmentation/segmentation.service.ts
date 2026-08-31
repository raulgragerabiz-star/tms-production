import { PrismaClient, ServiceSegment } from "@prisma/client";
import { getOrLoad, invalidate } from "../../lib/memory-cache";

export interface SegmentationRuleInput {
  segment: ServiceSegment;
  maxWeightKg: number | null;
  maxPallets: number | null;
  maxWeightPerPalletKg: number | null;
  maxVolumeM3: number | null;
  priority: number;
}

export interface OrderAggregates {
  totalWeightKg: number;
  totalPallets: number;
  totalVolumeM3: number;
  maxWeightPerPalletKg?: number; // peso del palé más pesado del pedido, si aplica
}

/**
 * Clasificación de segmento — función pura, sin efectos secundarios.
 * Documento v1.1 §2.3. La primera regla (ordenada por priority) que cumple
 * TODOS los límites definidos (los NULL se ignoran, "sin límite") gana.
 * Fallback: gran_volumen si ninguna regla matchea.
 */
export function classifyServiceSegment(
  order: OrderAggregates,
  rules: SegmentationRuleInput[]
): ServiceSegment {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  for (const r of sorted) {
    const okWeight = r.maxWeightKg == null || order.totalWeightKg <= r.maxWeightKg;
    const okPallets = r.maxPallets == null || order.totalPallets <= r.maxPallets;
    const okVolume = r.maxVolumeM3 == null || order.totalVolumeM3 <= r.maxVolumeM3;
    const okWeightPerPallet =
      r.maxWeightPerPalletKg == null ||
      order.maxWeightPerPalletKg == null ||
      order.maxWeightPerPalletKg <= r.maxWeightPerPalletKg;

    if (okWeight && okPallets && okVolume && okWeightPerPallet) {
      return r.segment;
    }
  }

  return ServiceSegment.gran_volumen;
}

/**
 * Días hábiles entre dos fechas (lunes-viernes, sin festivos por ahora —
 * el calendario de festivos ya existe para el suplemento de tarifas,
 * Fase 9; se reutilizará aquí en una iteración posterior si se requiere
 * precisión festiva en el lead time).
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
 * OPTIMIZACIÓN: sin este cache, un import de erpclaud de 500 pedidos
 * lanzaba 500 SELECT idénticos contra `service_segmentation_rule` (una
 * por pedido, dentro del bucle de `processErpclaudImport`) — con el cache,
 * solo la primera petición del lote toca BD; el resto se resuelve en
 * memoria. Las reglas cambian con muy poca frecuencia (configuración,
 * no operación diaria), por eso un TTL de 5 minutos es seguro.
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

/**
 * Carga las reglas activas de una empresa y calcula el segmento + leadTimeDays
 * para un pedido ya persistido. Se invoca al crear/actualizar un Order
 * (bridge ERP, bridge WMS, alta manual) y bajo demanda desde el Planificador.
 *
 * OPTIMIZACIÓN: acepta `preloadedRules` opcional para que un caller que ya
 * procesa varios pedidos en el mismo lote (ver erpclaud.service.ts) pueda
 * cargar las reglas UNA vez fuera del bucle y pasarlas aquí, evitando
 * incluso el overhead de mirar el cache en cada iteración.
 */
export async function classifyOrder(
  prisma: PrismaClient,
  companyId: string,
  orderId: string,
  preloadedRules?: Awaited<ReturnType<typeof getActiveSegmentationRules>>
): Promise<{ segment: ServiceSegment; leadTimeDays: number; suggestedUrgent: boolean }> {
  const [rules, order] = await Promise.all([
    preloadedRules ? Promise.resolve(preloadedRules) : getActiveSegmentationRules(prisma, companyId),
    prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      // OPTIMIZACIÓN: select explícito en vez de traer la fila completa +
      // relación completa de producto — solo se necesitan 3 campos del
      // producto para clasificar, no su descripción/carriageNote/etc.
      select: {
        id: true,
        createdAt: true,
        requestedDeliveryDate: true,
        priority: true,
        orderLines: {
          select: {
            quantity: true,
            lineWeightKg: true,
            volumeM3: true,
            product: {
              select: { unitsPerPallet: true, fullPalletWeightKg: true },
            },
          },
        },
      },
    }),
  ]);

  let totalWeightKg = 0;
  let totalVolumeM3 = 0;
  let totalPallets = 0;
  let maxWeightPerPalletKg = 0;

  for (const line of order.orderLines) {
    const weight = Number(line.lineWeightKg ?? 0);
    totalWeightKg += weight;
    if (line.volumeM3) totalVolumeM3 += Number(line.volumeM3);

    const unitsPerPallet = line.product.unitsPerPallet ?? 1;
    const palletsForLine = unitsPerPallet > 0 ? Number(line.quantity) / unitsPerPallet : 0;
    totalPallets += palletsForLine;

    const fullPalletWeight = Number(line.product.fullPalletWeightKg ?? 0);
    if (fullPalletWeight > maxWeightPerPalletKg) maxWeightPerPalletKg = fullPalletWeight;
  }

  const segment = classifyServiceSegment(
    { totalWeightKg, totalPallets, totalVolumeM3, maxWeightPerPalletKg },
    rules.map((r) => ({
      segment: r.segment,
      maxWeightKg: r.maxWeightKg ? Number(r.maxWeightKg) : null,
      maxPallets: r.maxPallets ? Number(r.maxPallets) : null,
      maxWeightPerPalletKg: r.maxWeightPerPalletKg ? Number(r.maxWeightPerPalletKg) : null,
      maxVolumeM3: r.maxVolumeM3 ? Number(r.maxVolumeM3) : null,
      priority: r.priority,
    }))
  );

  const leadTimeDays = diasHabiles(order.createdAt, order.requestedDeliveryDate);
  const suggestedUrgent = leadTimeDays <= 1;

  await prisma.order.update({
    where: { id: orderId },
    data: {
      serviceType: segment,
      segmentAutoAssigned: true,
      ...(suggestedUrgent && order.priority !== "urgent" ? {} : {}), // nunca se fuerza, ver §2.4
    },
  });

  return { segment, leadTimeDays, suggestedUrgent };
}
