import { ServiceSegment } from "@prisma/client";

export interface PendingOrderForGrouping {
  orderId: string;
  provinceId: string;
  lat: number | null;
  lng: number | null;
  segment: ServiceSegment;
  leadTimeDays: number;
}

export interface ZoneCluster {
  key: string;
  orders: PendingOrderForGrouping[];
}

const DEFAULT_CLUSTER_RADIUS_KM = 15; // (config) — documento v1.1 §3.3

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const KM_PER_DEGREE_LAT = 111; // aproximación estándar, suficiente para clustering (no para navegación)

/**
 * Índice espacial simple por rejilla: cada celda mide aproximadamente
 * `cellSizeKm` de lado. Los pedidos se agrupan por celda para poder
 * recuperar en O(1) "los pedidos cerca de este punto" en vez de recorrer
 * la lista completa. Es una estructura desechable, reconstruida en cada
 * llamada a `groupOrdersIntoZones` — no se persiste ni se comparte entre
 * invocaciones, coherente con que la agrupación es un cálculo bajo
 * demanda del Planificador, no un dato de negocio a mantener.
 */
function buildGridIndex(
  orders: PendingOrderForGrouping[],
  cellSizeKm: number
): Map<string, PendingOrderForGrouping[]> {
  const grid = new Map<string, PendingOrderForGrouping[]>();

  for (const order of orders) {
    if (order.lat == null || order.lng == null) continue;
    const key = cellKeyFor(order.lat, order.lng, cellSizeKm);
    const bucket = grid.get(key) ?? [];
    bucket.push(order);
    grid.set(key, bucket);
  }

  return grid;
}

function cellKeyFor(lat: number, lng: number, cellSizeKm: number): string {
  const kmPerDegreeLng = KM_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180) || 1; // evita división por 0 en el polo
  const row = Math.floor(lat / (cellSizeKm / KM_PER_DEGREE_LAT));
  const col = Math.floor(lng / (cellSizeKm / kmPerDegreeLng));
  return `${row}:${col}`;
}

/**
 * Devuelve los pedidos de la celda del punto dado y sus 8 celdas vecinas
 * (3x3) — suficiente para no perder candidatos que caigan justo al otro
 * lado del borde de una celda, con un coste acotado (máximo 9 buckets
 * consultados, no toda la rejilla).
 */
function getNeighborCandidates(
  grid: Map<string, PendingOrderForGrouping[]>,
  lat: number,
  lng: number,
  cellSizeKm: number
): PendingOrderForGrouping[] {
  const kmPerDegreeLng = KM_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180) || 1;
  const centerRow = Math.floor(lat / (cellSizeKm / KM_PER_DEGREE_LAT));
  const centerCol = Math.floor(lng / (cellSizeKm / kmPerDegreeLng));

  const candidates: PendingOrderForGrouping[] = [];
  for (let dRow = -1; dRow <= 1; dRow++) {
    for (let dCol = -1; dCol <= 1; dCol++) {
      const bucket = grid.get(`${centerRow + dRow}:${centerCol + dCol}`);
      if (bucket) candidates.push(...bucket);
    }
  }
  return candidates;
}

/**
 * Fase de blocking previa a la secuenciación (vecino más próximo + 2-opt,
 * ya existente en el motor de optimización, Fase 8). Reutiliza exactamente
 * el mismo patrón de blocking ya usado en motor-matching-survivorship.md §3
 * para evitar comparar todo contra todo — aquí, para evitar mezclar en una
 * misma ruta candidata pedidos de zonas geográficamente incompatibles.
 *
 * 1. Agrupa primero por provincia (province_catalog, ya existente).
 * 2. Dentro de una provincia con volumen alto, subdivide por clúster
 *    geográfico simple (radio configurable, distancia Haversine, sin
 *    dependencias externas — evita acoplar esta capa a un proveedor de mapas).
 * 3. Ordena los clústeres resultantes por leadTimeDays medio ascendente,
 *    para que el planificador (o el motor en modo automático) atienda
 *    primero las zonas con pedidos más urgentes.
 */
export function groupOrdersIntoZones(
  orders: PendingOrderForGrouping[],
  clusterRadiusKm: number = DEFAULT_CLUSTER_RADIUS_KM
): ZoneCluster[] {
  const byProvince = new Map<string, PendingOrderForGrouping[]>();
  for (const o of orders) {
    const list = byProvince.get(o.provinceId) ?? [];
    list.push(o);
    byProvince.set(o.provinceId, list);
  }

  const clusters: ZoneCluster[] = [];

  for (const [provinceId, provinceOrders] of byProvince) {
    // Volumen bajo: la provincia entera es un único clúster, sin subdividir.
    if (provinceOrders.length <= 8) {
      clusters.push({ key: `province:${provinceId}`, orders: provinceOrders });
      continue;
    }

    // Volumen alto: clustering geográfico por rejilla espacial (grid
    // index) en vez de comparar cada pedido contra todos los demás.
    //
    // OPTIMIZACIÓN: la versión anterior era O(n²) — cada pedido se
    // comparaba con TODOS los restantes de la provincia mediante
    // Haversine. Para una provincia con, por ejemplo, 400 pedidos en un
    // día de campaña, eso son hasta 160.000 cálculos de distancia. La
    // rejilla agrupa primero por celdas de tamaño ≈ clusterRadiusKm, así
    // que solo hace falta comparar cada pedido contra los de su celda y
    // las 8 celdas vecinas — pasa a ser ~O(n) en la práctica para
    // distribuciones geográficas razonablemente uniformes (que es el caso
    // real: pedidos repartidos por polígonos industriales de una
    // provincia, no todos en el mismo punto).
    const grid = buildGridIndex(provinceOrders, clusterRadiusKm);
    const consumed = new Set<string>();
    const remaining = [...provinceOrders];
    let clusterIndex = 0;

    while (remaining.length > 0) {
      const seed = remaining.shift()!;
      if (consumed.has(seed.orderId)) continue;
      consumed.add(seed.orderId);

      const clusterOrders = [seed];

      if (seed.lat != null && seed.lng != null) {
        const candidates = getNeighborCandidates(grid, seed.lat, seed.lng, clusterRadiusKm);

        for (const candidate of candidates) {
          if (consumed.has(candidate.orderId)) continue;
          if (candidate.lat == null || candidate.lng == null) continue;

          const dist = haversineKm(
            { lat: seed.lat, lng: seed.lng },
            { lat: candidate.lat, lng: candidate.lng }
          );
          if (dist <= clusterRadiusKm) {
            clusterOrders.push(candidate);
            consumed.add(candidate.orderId);
          }
        }
      }

      clusters.push({
        key: `province:${provinceId}:cluster:${clusterIndex++}`,
        orders: clusterOrders,
      });
    }
    // `remaining` ya no se usa como estructura de control tras este punto
    // (se sustituyó por el Set `consumed`); se deja fuera del bucle
    // original a propósito, ver nota de diseño arriba.
  }

  // Priorizar zonas con pedidos más urgentes primero (§3.3, paso 3)
  clusters.sort((a, b) => avgLeadTime(a.orders) - avgLeadTime(b.orders));

  return clusters;
}

function avgLeadTime(orders: PendingOrderForGrouping[]): number {
  if (orders.length === 0) return Infinity;
  return orders.reduce((sum, o) => sum + o.leadTimeDays, 0) / orders.length;
}

/**
 * Filtro de compatibilidad de segmento — se añade a la capa de generación
 * de candidatos ya existente (09-motor-optimizacion-TMS.md §1), ANTES del
 * filtro de peso/palés ya implementado. Documento v1.1 §3.2.
 */
export function isVehicleTypeCompatibleWithSegment(
  compatibleSegments: ServiceSegment[],
  orderSegment: ServiceSegment
): boolean {
  if (!compatibleSegments || compatibleSegments.length === 0) {
    // Sin restricción configurada -> compatible con todo (degradación segura,
    // documento v1.1 §8, fila 3: "el motor sigue funcionando sin ellos").
    return true;
  }
  return compatibleSegments.includes(orderSegment);
}
