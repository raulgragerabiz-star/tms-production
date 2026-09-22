// Fase 19: dos bloques nuevos de la pestaña "Zonas / Vehículos" -- petición
// explícita de Raúl a partir de un informe de referencia propio (capturas:
// "Criterio de asignación ruta/cliente por distancia real" + "Dispersión
// geográfica de las rutas actuales"). Los números de ese informe son de
// referencia (formato y forma de calcular), no datos a insertar -- aquí se
// calculan con el histórico real de clientes geolocalizados, igual que el
// resto de analítica de esta fase ("todo en memoria con Prisma, acumulado
// real, sin fecha límite").
//
// Nota: se duplica aquí (en vez de reutilizar dashboard.routes.ts
// /clients-map directamente) la resolución de "almacén ancla" de cada
// cliente activo -- esa pantalla ya pasó por varias rondas de corrección
// (Fase 16, mapa de Inicio) y se prefiere no arriesgar tocarla; solo se
// comparte la tabla de cortes de distancia (@/lib/distance-tiers) para que
// ambas pantallas usen siempre los mismos límites y no diverjan.
import { prisma } from "@/lib/prisma";
import { haversineKm, RoutePoint } from "@/modules/routing/routing.service";
import { resolveDeliveryZonesForPairs } from "@/modules/customers/customer-zone-resolution";
import { DISTANCE_TIERS, classifyDistanceKm } from "@/lib/distance-tiers";

// Vehículo y frecuencia TÍPICA sugerida para cada franja -- texto
// descriptivo informativo, no una regla que decida nada automáticamente (a
// diferencia del "vehículo recomendado" de fleet-sizing.service.ts, que sí
// sale del histórico real de peso por circuito). Mismo texto que el informe
// de referencia de Raúl; ajustable si lo confirma distinto una vez vea la
// pantalla con datos reales.
const TIER_GUIDANCE: Record<string, { vehiculo: string; frecuencia: string }> = {
  metropolitana: { vehiculo: "Furgón / rígido 7,5 t", frecuencia: "Diaria (5-6 salidas/semana)" },
  regional_cercana: { vehiculo: "Rígido 7,5-12 t", frecuencia: "3-4 salidas/semana" },
  regional_extendida: { vehiculo: "Rígido 12-18 t", frecuencia: "2 salidas/semana" },
  larga_distancia: { vehiculo: "Tráiler", frecuencia: "1-2 salidas/semana" },
  internacional: { vehiculo: "Tráiler programado", frecuencia: "1 salida/semana fija" },
};

export interface DistanceTierSummaryRow {
  tier: string;
  label: string;
  clientes: number;
  vehiculoSugerido: string;
  frecuenciaSugerida: string;
}

export interface RouteDispersionRow {
  deliveryZoneId: string;
  deliveryZoneName: string;
  minKm: number;
  mediaKm: number;
  maxKm: number;
  dispersionKm: number;
  clientes: number;
}

export interface DistanceAnalyticsResult {
  criterioDistancia: DistanceTierSummaryRow[];
  dispersionGeografica: RouteDispersionRow[];
}

// Fase 22: mismo filtro por centro de origen que fleet-sizing.service.ts
// (ver comentario ahí) -- petición explícita de Raúl porque este bloque no
// cambiaba nunca al elegir otro almacén en "Zonas de influencia". Aquí el
// filtro es por el almacén ANCLA resuelto de cada cliente (no por
// Order.warehouseId como en fleet-sizing.service.ts): "criterio de
// distancia" y "dispersión geográfica" hablan de clientes por su dirección,
// no de pedidos ya servidos, así que el almacén relevante es desde el que
// se les serviría (ver resolveAnchorWarehouseId más abajo), igual que en
// /dashboard/clients-map.
export async function computeDistanceAnalytics(companyId: string, warehouseId?: string): Promise<DistanceAnalyticsResult> {
  const [warehouses, customers] = await Promise.all([
    prisma.warehouse.findMany({
      where: { companyId, active: true, lat: { not: null }, lng: { not: null } },
      select: { id: true, name: true, lat: true, lng: true },
    }),
    prisma.customer.findMany({
      where: { companyId, active: true, deletedAt: null },
      select: {
        id: true,
        deliveryPoints: {
          where: { active: true, deletedAt: null, lat: { not: null }, lng: { not: null } },
          select: { lat: true, lng: true },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
        deliveryZone: { select: { warehouseId: true } },
      },
    }),
  ]);

  const warehouseById = new Map<string, (typeof warehouses)[number]>(warehouses.map((w: any) => [w.id, w]));

  // Mismo criterio de resolución de "almacén ancla" que /dashboard/clients-map
  // (Fase 16): 1) el almacén del circuito por defecto del cliente si está
  // geolocalizado, 2) si solo hay un almacén geolocalizado, ese, 3) si no, el
  // más cercano en línea recta.
  function resolveAnchorWarehouseId(point: RoutePoint, zoneWarehouseId: string | null | undefined): string | null {
    if (zoneWarehouseId) {
      const zw = warehouseById.get(zoneWarehouseId);
      if (zw) return zw.id;
    }
    if (warehouses.length === 1) return warehouses[0].id;
    if (warehouses.length === 0) return null;
    let nearest: { id: string; km: number } | null = null;
    for (const w of warehouses) {
      const km = haversineKm(point, { lat: w.lat!, lng: w.lng! });
      if (!nearest || km < nearest.km) nearest = { id: w.id, km };
    }
    return nearest?.id ?? null;
  }

  const zonePairs: Array<{ customerId: string; warehouseId: string }> = [];
  const anchorByCustomer = new Map<string, string>();
  const kmByCustomer = new Map<string, number>();
  const tierByCustomer = new Map<string, { tier: string; label: string }>();

  for (const c of customers) {
    const point = c.deliveryPoints[0];
    if (!point) continue;
    const anchorId = resolveAnchorWarehouseId({ lat: point.lat!, lng: point.lng! }, c.deliveryZone?.warehouseId ?? null);
    if (!anchorId) continue;
    if (warehouseId && anchorId !== warehouseId) continue; // Fase 22: filtro por centro de origen
    const warehouse = warehouseById.get(anchorId)!;
    const km = haversineKm({ lat: warehouse.lat!, lng: warehouse.lng! }, { lat: point.lat!, lng: point.lng! });
    anchorByCustomer.set(c.id, anchorId);
    kmByCustomer.set(c.id, km);
    tierByCustomer.set(c.id, classifyDistanceKm(km));
    zonePairs.push({ customerId: c.id, warehouseId: anchorId });
  }

  const zoneByPair = await resolveDeliveryZonesForPairs(zonePairs);

  // 1) Clientes activos geolocalizados por franja de distancia.
  const tierCounts = new Map<string, number>();
  for (const t of tierByCustomer.values()) {
    tierCounts.set(t.tier, (tierCounts.get(t.tier) ?? 0) + 1);
  }
  const criterioDistancia: DistanceTierSummaryRow[] = DISTANCE_TIERS.map((t) => ({
    tier: t.tier,
    label: t.label,
    clientes: tierCounts.get(t.tier) ?? 0,
    vehiculoSugerido: TIER_GUIDANCE[t.tier]?.vehiculo ?? "—",
    frecuenciaSugerida: TIER_GUIDANCE[t.tier]?.frecuencia ?? "—",
  }));

  // 2) Dispersión (mín/media/máx/desviación típica) de la distancia real al
  // almacén de los clientes de cada circuito -- una dispersión alta señala
  // un circuito que mezcla clientes cercanos y lejanos, candidato a
  // dividirse en dos (mismo concepto que el informe de referencia de Raúl).
  const byZone = new Map<string, { name: string; kms: number[] }>();
  for (const c of customers) {
    const anchorId = anchorByCustomer.get(c.id);
    const km = kmByCustomer.get(c.id);
    if (!anchorId || km == null) continue;
    const zone = zoneByPair.get(`${c.id}::${anchorId}`);
    if (!zone) continue;
    const bucket = byZone.get(zone.id) ?? { name: zone.name, kms: [] };
    bucket.kms.push(km);
    byZone.set(zone.id, bucket);
  }

  const dispersionGeografica: RouteDispersionRow[] = [];
  for (const [zoneId, bucket] of byZone.entries()) {
    const n = bucket.kms.length;
    if (n === 0) continue;
    const mean = bucket.kms.reduce((a, b) => a + b, 0) / n;
    const variance = bucket.kms.reduce((acc, km) => acc + (km - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);
    dispersionGeografica.push({
      deliveryZoneId: zoneId,
      deliveryZoneName: bucket.name,
      minKm: Math.round(Math.min(...bucket.kms) * 10) / 10,
      mediaKm: Math.round(mean * 10) / 10,
      maxKm: Math.round(Math.max(...bucket.kms) * 10) / 10,
      dispersionKm: Math.round(stddev * 10) / 10,
      clientes: n,
    });
  }
  dispersionGeografica.sort((a, b) => b.dispersionKm - a.dispersionKm); // más dispersa primero, igual que el informe de referencia

  return { criterioDistancia, dispersionGeografica };
}
