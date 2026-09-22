// Fase 17: "Zonas / Vehículos" -- segunda sección de "Flota y Transportistas"
// (petición explícita de Raúl, sustituyendo la pestaña "Conductores"):
// "otra seccion que sera zonas / vehiculos, donde se segmentara por ruta...
// con el acumulado de informacion unos datos como los de la imagen (cantidad
// de envios, media de kg repartos por dia, % de uso flota optima por tipo de
// ruta y necesidad de vhiculos por dia)".
//
// Aclarado con Raúl en pregunta directa: "tipología de reparto" no es un eje
// de segmentación aparte (no es el ServiceType del pedido) -- es EL
// RESULTADO que se calcula por ruta: qué tipo de vehículo es el adecuado
// según los kg/palés que se reparten habitualmente a esa zona. El criterio
// de "vehículo recomendado" que confirmó Raúl: "el más pequeño que cubra el
// P85" -- evita sobredimensionar la flota; un ~15% de las salidas más
// pesadas puede superar puntualmente esa capacidad (columna "% salidas
// exceden").
//
// Fuente de datos: histórico real de Route + RouteStop + Order (mismo
// criterio "todo en memoria con Prisma normal, sin SQL a medida" que
// dashboard.routes.ts /accumulated, y mismo cálculo de percentiles que
// demand-forecast.service.ts). Sin filtro de fecha -- acumulado real
// completo, igual que el resto de analítica de esta fase.
//
// Nota para Raúl: si el histórico real de rutas en el sistema es todavía
// escaso (muchos pedidos sin planificar en ninguna ruta), esta pantalla
// mostrará pocos o ningún circuito hasta que se acumule más operativa real
// -- es el mismo caso ya visto en /dashboard/accumulated con los datos de
// prueba. Puede compartir el Excel histórico que mencionó para validar que
// estos cálculos coinciden con su referencia antes de que haya suficiente
// histórico real en el sistema.
import { prisma } from "@/lib/prisma";
import { resolveDeliveryZonesForPairs } from "@/modules/customers/customer-zone-resolution";
import { percentile } from "@/modules/intelligence/demand-forecast.service";

// Nota de alcance: Raúl mencionó también la distancia/radio de reparto de
// los clientes como parte de lo que determina la tipología de vehículo
// adecuada. De momento el peso por salida (que ya integra implícitamente el
// volumen servido a cada zona) es la única variable usada para recomendar
// vehículo -- añadir la franja de distancia (ver DISTANCE_TIERS en
// dashboard.routes.ts, Fase 16) como segundo eje de segmentación queda como
// mejora futura si el Excel histórico que puede aportar Raúl lo pide.

const WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

// Umbral heurístico: un circuito "opera" un día de la semana concreto, de
// cara a dimensionar la flota COMPARTIDA, si al menos este % de sus salidas
// históricas cayeron en ese día. Sin este filtro, una salida puntual en un
// día atípico (una ruta que casi siempre sale en martes pero una vez salió
// en sábado por una incidencia) contaría como que esa ruta "opera los
// sábados" y sobredimensionaría la flota compartida necesaria ese día.
// (config) -- primer valor razonable; ajustable si el Excel histórico que
// puede aportar Raúl sugiere otro criterio.
const WEEKDAY_ACTIVE_THRESHOLD = 0.1;

export interface FleetSizingRouteRow {
  deliveryZoneId: string;
  deliveryZoneName: string;
  salidas: number;
  medianaKg: number;
  p85Kg: number;
  maximoKg: number;
  vehiculoRecomendado: { id: string; name: string; maxWeightKg: number } | null;
  vehiculosNecesarios: number;
  utilizacionPct: number | null;
  pctSalidasExceden: number;
}

// Fase 19: "resumen acumulado por ruta" -- petición explícita de Raúl a
// partir de un informe de referencia propio (kg totales, pedidos, clientes,
// viajes, kg/viaje y frecuencia por circuito), para "inyectar información en
// la parte de Zonas/Vehículos, en la analítica de flota por circuito". Los
// números de ese informe son de referencia (tiene más histórico acumulado
// que el que hay cargado todavía en este sistema) -- aquí se calcula igual
// que el resto de esta pantalla, con el histórico real de Route + RouteStop
// + Order, así que el resultado crecerá hacia esas cifras a medida que se
// acumule más operativa real (mismo aviso que ya existe para la tabla de
// percentiles de arriba).
//
// A diferencia de la tabla de percentiles (que atribuye cada ruta ENTERA a
// su circuito dominante, para poder calcular un P85 por ruta), aquí cada
// parada se atribuye a SU PROPIO circuito resuelto (cliente+almacén) --
// más preciso para sumar kg/pedidos/clientes reales de un circuito, aunque
// una misma ruta reparta en más de uno. Por eso "viajes" aquí puede no
// coincidir con "salidas" de la tabla de arriba: "viajes" cuenta cualquier
// ruta que haya tenido AL MENOS una parada en ese circuito, no solo las
// rutas en las que ese circuito fue el dominante.
export interface RouteAccumulatedRow {
  deliveryZoneId: string;
  deliveryZoneName: string;
  kgTotales: number;
  pedidos: number;
  clientes: number;
  viajes: number;
  kgPorViaje: number;
  frecuencia: string;
}

export interface FleetSizingResult {
  rutas: FleetSizingRouteRow[];
  flota: {
    dedicada: number;
    porDiaSemana: { day: number; label: string; vehiculos: number }[];
    compartidaMax: number;
    diaMayorConcurrenciaLabel: string | null;
    reduccionPct: number | null;
  };
  resumenAcumulado: RouteAccumulatedRow[];
}

// Días en minúscula y sin tilde, mismo formato que el informe de referencia
// de Raúl para la columna "frecuencia" ("lunes y miercoles", "martes y
// jueves", "miercoles"...) -- distinto de WEEKDAY_LABELS (con tilde, usado en
// las tarjetas de la flota compartida), que no se toca.
const WEEKDAY_LABELS_PLAIN = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

// Umbral de cobertura: si un subconjunto pequeño (máx. 5) de días concentra
// al menos este % de los viajes de un circuito, se listan esos días como su
// frecuencia. Si ningún subconjunto así de pequeño llega a cubrir ese %
// (reparto repartido entre muchos días sin patrón fijo, p.ej. "según pedido"),
// se etiqueta como "cuando hay peso" -- igual que el circuito "MANCHA" del
// informe de referencia. Ajustable si no encaja con la realidad una vez haya
// más histórico.
const FREQUENCY_COVERAGE_THRESHOLD = 0.9;
const FREQUENCY_MAX_DAYS = 5;

function describeWeeklyFrequency(weekdayCounts: number[], totalViajes: number): string {
  if (totalViajes === 0) return "Sin histórico";
  const sorted = weekdayCounts.map((count, day) => ({ day, count })).sort((a, b) => b.count - a.count);
  const chosen: number[] = [];
  let covered = 0;
  for (const { day, count } of sorted) {
    if (count === 0) break;
    chosen.push(day);
    covered += count;
    if (covered / totalViajes >= FREQUENCY_COVERAGE_THRESHOLD) break;
  }
  if (chosen.length === 0 || chosen.length > FREQUENCY_MAX_DAYS) return "cuando hay peso";
  chosen.sort((a, b) => a - b);
  const names = chosen.map((d) => WEEKDAY_LABELS_PLAIN[d]);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(" ")} y ${names[names.length - 1]}`;
}

// Fase 22: petición explícita de Raúl -- "esa parte es con datos de almacen
// getafe, al cambiar de almacen en las zonas de influencia, los datos de
// getafe se mantienen a la vista". Hasta ahora esta pantalla no filtraba por
// almacén en absoluto (agregaba TODOS los circuitos de la empresa, viniera
// el pedido de donde viniera) -- de ahí que pareciera "atascada" en Getafe:
// simplemente no cambiaba nunca. `warehouseId` (opcional) filtra cada parada
// por el almacén REAL desde el que se sirvió el pedido (`Order.warehouseId`,
// el dato real de fulfillment -- no una heurística de cercanía como en
// fleet-sizing-distance.service.ts, que trabaja con clientes sin pedidos
// todavía). Sin `warehouseId`, el comportamiento es idéntico al de siempre
// (todos los almacenes juntos).
export async function computeFleetSizing(companyId: string, warehouseId?: string): Promise<FleetSizingResult> {
  const [routes, vehicleTypes] = await Promise.all([
    prisma.route.findMany({
      where: { companyId },
      select: {
        id: true,
        routeDate: true,
        stops: {
          select: {
            order: {
              // Fase 19: se añade `id` -- necesario para contar pedidos
              // distintos por circuito en el resumen acumulado (ver
              // RouteAccumulatedRow); no se usaba hasta ahora.
              select: { id: true, customerId: true, warehouseId: true, lines: { select: { lineWeightKg: true } } },
            },
          },
        },
      },
    }),
    // VehicleType es maestro global (sin companyId, ver schema.prisma) --
    // mismo criterio que GET /vehicles/types.
    prisma.vehicleType.findMany({ orderBy: { maxWeightKg: "asc" } }),
  ]);

  // Circuito efectivo de cada combinación cliente+almacén que aparece en
  // alguna parada de alguna ruta -- misma resolución en lote que
  // /dashboard/accumulated ("top rutas por volumen").
  const pairsMap = new Map<string, { customerId: string; warehouseId: string }>();
  for (const r of routes) {
    for (const s of r.stops) {
      if (warehouseId && s.order.warehouseId !== warehouseId) continue; // Fase 22: filtro por centro de origen
      const key = `${s.order.customerId}::${s.order.warehouseId}`;
      if (!pairsMap.has(key)) pairsMap.set(key, { customerId: s.order.customerId, warehouseId: s.order.warehouseId });
    }
  }
  const zoneByPair = await resolveDeliveryZonesForPairs([...pairsMap.values()]);

  // Peso total y circuito "dominante" (el de mayor peso entre sus paradas)
  // de cada salida -- nada obliga a que una ruta solo tenga paradas de un
  // circuito, pero para poder agregar "por ruta" (como en el ejemplo de
  // Raúl) se le atribuye el que más peso aporta, mismo criterio que ya usa
  // /dashboard/clients-map para el almacén de referencia de un cliente.
  interface RouteAgg {
    weightKg: number;
    weekday: number;
    zoneId: string | null;
    zoneName: string | null;
  }
  // Fase 19: "resumen acumulado por ruta" -- a diferencia de routeAggs (que
  // solo se queda con el circuito DOMINANTE de cada ruta, para el cálculo de
  // percentiles), aquí se suma cada parada a SU PROPIO circuito, sin
  // simplificar a uno solo por ruta -- ver comentario largo junto a
  // RouteAccumulatedRow más arriba.
  interface ZoneTouchAgg {
    name: string;
    kgTotales: number;
    orderIds: Set<string>;
    customerIds: Set<string>;
    routeIds: Set<string>;
    weekdayCounts: number[];
  }
  const zoneTouchAgg = new Map<string, ZoneTouchAgg>();

  const routeAggs: RouteAgg[] = [];
  for (const r of routes) {
    if (r.stops.length === 0) continue;
    const weightByZone = new Map<string, { name: string; weightKg: number }>();
    let totalWeightKg = 0;
    const weekday = (r.routeDate.getUTCDay() + 6) % 7; // 0 = lunes, igual que /dashboard/accumulated
    for (const s of r.stops) {
      if (warehouseId && s.order.warehouseId !== warehouseId) continue; // Fase 22: filtro por centro de origen
      const weightKg = s.order.lines.reduce((acc: number, l: any) => acc + Number(l.lineWeightKg ?? 0), 0);
      totalWeightKg += weightKg;
      const zone = zoneByPair.get(`${s.order.customerId}::${s.order.warehouseId}`);
      if (!zone) continue;
      const bucket = weightByZone.get(zone.id) ?? { name: zone.name, weightKg: 0 };
      bucket.weightKg += weightKg;
      weightByZone.set(zone.id, bucket);

      const touch = zoneTouchAgg.get(zone.id) ?? {
        name: zone.name,
        kgTotales: 0,
        orderIds: new Set<string>(),
        customerIds: new Set<string>(),
        routeIds: new Set<string>(),
        weekdayCounts: [0, 0, 0, 0, 0, 0, 0],
      };
      touch.kgTotales += weightKg;
      touch.orderIds.add(s.order.id);
      touch.customerIds.add(s.order.customerId);
      if (!touch.routeIds.has(r.id)) touch.weekdayCounts[weekday] += 1; // una vez por ruta, no por parada
      touch.routeIds.add(r.id);
      zoneTouchAgg.set(zone.id, touch);
    }
    if (totalWeightKg <= 0) continue; // sin peso real, no aporta a los percentiles

    let dominantId: string | null = null;
    let dominant: { name: string; weightKg: number } | null = null;
    for (const [zoneId, bucket] of weightByZone.entries()) {
      if (!dominant || bucket.weightKg > dominant.weightKg) {
        dominant = bucket;
        dominantId = zoneId;
      }
    }
    routeAggs.push({ weightKg: totalWeightKg, weekday, zoneId: dominantId, zoneName: dominant?.name ?? null });
  }

  const resumenAcumulado: RouteAccumulatedRow[] = [...zoneTouchAgg.entries()]
    .map(([zoneId, t]) => {
      const viajes = t.routeIds.size;
      return {
        deliveryZoneId: zoneId,
        deliveryZoneName: t.name,
        kgTotales: Math.round(t.kgTotales),
        pedidos: t.orderIds.size,
        clientes: t.customerIds.size,
        viajes,
        kgPorViaje: viajes > 0 ? Math.round(t.kgTotales / viajes) : 0,
        frecuencia: describeWeeklyFrequency(t.weekdayCounts, viajes),
      };
    })
    .sort((a, b) => b.kgTotales - a.kgTotales); // más volumen primero, igual que el informe de referencia

  // Agrupar por circuito.
  const byZone = new Map<string, { name: string; weights: number[]; weekdayCounts: number[] }>();
  for (const ra of routeAggs) {
    if (!ra.zoneId || !ra.zoneName) continue; // sin circuito resoluble, no se puede dimensionar
    const bucket = byZone.get(ra.zoneId) ?? { name: ra.zoneName, weights: [], weekdayCounts: [0, 0, 0, 0, 0, 0, 0] };
    bucket.weights.push(ra.weightKg);
    bucket.weekdayCounts[ra.weekday] += 1;
    byZone.set(ra.zoneId, bucket);
  }

  const rutas: FleetSizingRouteRow[] = [];
  for (const [zoneId, bucket] of byZone.entries()) {
    const sorted = [...bucket.weights].sort((a, b) => a - b);
    const medianaKg = percentile(sorted, 0.5);
    const p85Kg = percentile(sorted, 0.85);
    const maximoKg = sorted[sorted.length - 1];

    // El más pequeño que cubra el P85 -- criterio confirmado por Raúl. Si
    // ninguno configurado llega, se usa el mayor disponible (mejor esfuerzo,
    // nunca se deja la ruta sin recomendación).
    const recommended = vehicleTypes.find((vt: any) => Number(vt.maxWeightKg) >= p85Kg) ?? vehicleTypes[vehicleTypes.length - 1] ?? null;
    const capacityKg = recommended ? Number(recommended.maxWeightKg) : null;
    const exceeding = capacityKg != null ? bucket.weights.filter((w) => w > capacityKg).length : 0;

    rutas.push({
      deliveryZoneId: zoneId,
      deliveryZoneName: bucket.name,
      salidas: bucket.weights.length,
      medianaKg: Math.round(medianaKg),
      p85Kg: Math.round(p85Kg),
      maximoKg: Math.round(maximoKg),
      vehiculoRecomendado: recommended ? { id: recommended.id, name: recommended.name, maxWeightKg: capacityKg! } : null,
      // Nº de vehículos DEDICADOS que necesita este circuito -- 1 por ruta,
      // igual que en el ejemplo de Raúl ("flota dedicada = suma directa de
      // vehículos recomendados por ruta"). El ocasional exceso puntual sobre
      // el P85 (ver pctSalidasExceden) se asume gestionable operativamente,
      // no como necesidad de un segundo vehículo dedicado permanente.
      vehiculosNecesarios: recommended ? 1 : 0,
      utilizacionPct: capacityKg ? Math.round((medianaKg / capacityKg) * 1000) / 10 : null,
      pctSalidasExceden: bucket.weights.length > 0 ? Math.round((exceeding / bucket.weights.length) * 1000) / 10 : 0,
    });
  }
  rutas.sort((a, b) => b.medianaKg - a.medianaKg); // más carga primero, igual que el ejemplo de Raúl

  // Flota dedicada (1 por ruta, suma directa) vs. flota compartida real
  // (máximo de vehículos que coinciden el mismo día de la semana) -- mismo
  // concepto que el panel de referencia de Raúl ("del flota por ruta al
  // flota compartida real").
  const vehiculosPorDia = [0, 0, 0, 0, 0, 0, 0];
  for (const bucket of byZone.values()) {
    const totalSalidas = bucket.weekdayCounts.reduce((a, b) => a + b, 0);
    if (totalSalidas === 0) continue;
    for (let day = 0; day < 7; day++) {
      const share = bucket.weekdayCounts[day] / totalSalidas;
      if (share >= WEEKDAY_ACTIVE_THRESHOLD) vehiculosPorDia[day] += 1;
    }
  }
  const dedicada = rutas.reduce((acc, r) => acc + r.vehiculosNecesarios, 0);
  const compartidaMax = vehiculosPorDia.length > 0 ? Math.max(...vehiculosPorDia) : 0;
  const diaMayorConcurrenciaIdx = vehiculosPorDia.indexOf(compartidaMax);

  return {
    rutas,
    flota: {
      dedicada,
      porDiaSemana: WEEKDAY_LABELS.map((label, day) => ({ day, label, vehiculos: vehiculosPorDia[day] })),
      compartidaMax,
      diaMayorConcurrenciaLabel: compartidaMax > 0 ? WEEKDAY_LABELS[diaMayorConcurrenciaIdx] : null,
      reduccionPct: dedicada > 0 ? Math.round(((dedicada - compartidaMax) / dedicada) * 1000) / 10 : null,
    },
    resumenAcumulado,
  };
}
