import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { env } from "@/config/env";
import { estimateRoute, estimateStopEtas, suggestVehicleType, getRouteGeometry, STOP_SERVICE_MINUTES } from "@/modules/routing/routing.service";
import { optimizePlan, OrsNotConfiguredError, VroomJob, VroomVehicle } from "@/modules/routing/ors.service";
import { broadcastToWarehouse } from "@/realtime/ws.server";

export const routesRouter = Router();

export async function recalculateLoadPlan(routeId: string) {
  const stops = await prisma.routeStop.findMany({
    where: { routeId },
    orderBy: { sequence: "asc" },
    include: {
      order: {
        include: {
          lines: {
            include: {
              product: { select: { unitsPerPallet: true, lengthM: true, widthM: true, heightM: true } },
            },
          },
          deliveryPoint: { select: { lat: true, lng: true } },
        },
      },
    },
  });

  const totalWeightKg = stops.reduce(
    (acc, s) => acc + s.order.lines.reduce((a, l) => a + Number(l.lineWeightKg ?? 0), 0),
    0
  );
  // Palés = suma por línea de (cantidad / unidades por palé del producto), igual que el
  // clasificador de segmento (segmentation.service.ts) — antes esto era un placeholder
  // fijo de "1 palé por parada", que infravaloraba o sobrevaloraba la ocupación real según
  // el pedido y hacía inútil cualquier filtro de capacidad por palés.
  const totalPallets = stops.reduce(
    (acc, s) =>
      acc +
      s.order.lines.reduce((a, l) => {
        const unitsPerPallet = l.product.unitsPerPallet ?? 1;
        return a + (unitsPerPallet > 0 ? Number(l.quantity) / unitsPerPallet : 0);
      }, 0),
    0
  );

  // Volumen real ocupado = suma por línea de (palés de esa línea × volumen de un
  // palé completo del producto). Si un producto no tiene sus 3 dimensiones
  // cargadas, esa línea simplemente no aporta volumen (no rompe el resto del
  // cálculo) -- así el dato es parcial-pero-honesto mientras se completa el
  // maestro de productos, en vez de fallar o inventar un valor.
  const totalVolumeM3 = stops.reduce(
    (acc, s) =>
      acc +
      s.order.lines.reduce((a, l) => {
        const unitsPerPallet = l.product.unitsPerPallet ?? 1;
        const palletsForLine = unitsPerPallet > 0 ? Number(l.quantity) / unitsPerPallet : 0;
        const { lengthM, widthM, heightM } = l.product;
        const palletVolumeM3 = lengthM != null && widthM != null && heightM != null
          ? Number(lengthM) * Number(widthM) * Number(heightM)
          : 0;
        return a + palletsForLine * palletVolumeM3;
      }, 0),
    0
  );

  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: { vehicle: { include: { vehicleType: true } }, warehouse: { select: { lat: true, lng: true } } },
  });
  const maxWeight = route?.vehicle?.vehicleType?.maxWeightKg ? Number(route.vehicle.vehicleType.maxWeightKg) : null;
  const maxPallets = route?.vehicle?.vehicleType?.maxPallets ?? null;
  const maxVolume = route?.vehicle?.vehicleType?.maxVolumeM3 ? Number(route.vehicle.vehicleType.maxVolumeM3) : null;

  // Objetivo 2: distancia/tiempo estimados -- almacén como origen, luego cada
  // parada en su orden de secuencia. Si falta alguna coordenada (almacén o
  // alguna parada sin lat/lng todavía) simplemente no se calcula, sin romper
  // el resto del recálculo de ocupación.
  const routePoints = [
    route?.warehouse?.lat != null && route?.warehouse?.lng != null
      ? { lat: route.warehouse.lat, lng: route.warehouse.lng }
      : null,
    ...stops.map((s) =>
      s.order.deliveryPoint.lat != null && s.order.deliveryPoint.lng != null
        ? { lat: s.order.deliveryPoint.lat, lng: s.order.deliveryPoint.lng }
        : null
    ),
  ];
  const hasAllCoords = routePoints.every((p) => p !== null);
  const estimate = hasAllCoords ? await estimateRoute(routePoints as { lat: number; lng: number }[]) : null;

  // Fase 5b (Planificador estilo Bringg -- vista Despacho + Gantt): con las
  // mismas coordenadas ya validadas para la distancia total, se reparte una
  // hora estimada de llegada por parada. Rellena por fin `RouteStop.eta`,
  // campo que existía en el schema desde antes pero que ningún sitio
  // calculaba todavía. Hora de salida de referencia: 08:00 del día de la
  // ruta -- todavía no hay un horario de salida configurable por almacén o
  // ruta, así que es una aproximación documentada, igual de honesta que el
  // resto de esta estimación de ruta sin proveedor real.
  if (hasAllCoords && route) {
    const startAt = new Date(route.routeDate);
    startAt.setHours(8, 0, 0, 0);
    const etas = await estimateStopEtas(routePoints as { lat: number; lng: number }[], startAt);
    await Promise.all(stops.map((s, idx) => prisma.routeStop.update({ where: { id: s.id }, data: { eta: etas[idx] } })));
  } else if (stops.length > 0) {
    // Sin coordenadas completas no se puede calcular con garantías -- se
    // limpia cualquier ETA de un cálculo anterior con otras paradas, en vez
    // de dejar un valor obsoleto que ya no se corresponde con la ruta actual.
    await prisma.routeStop.updateMany({ where: { routeId }, data: { eta: null } });
  }

  await prisma.loadPlan.upsert({
    where: { routeId },
    create: {
      routeId,
      totalWeightKg,
      totalPallets,
      weightOccupancyPct: maxWeight ? totalWeightKg / maxWeight : 0,
      palletOccupancyPct: maxPallets ? totalPallets / maxPallets : 0,
      totalVolumeM3,
      volumeOccupancyPct: maxVolume ? totalVolumeM3 / maxVolume : 0,
      distanceKm: estimate?.distanceKm,
      estimatedDurationMin: estimate ? Math.round(estimate.durationMin) : null,
    },
    update: {
      totalWeightKg,
      totalPallets,
      weightOccupancyPct: maxWeight ? totalWeightKg / maxWeight : 0,
      palletOccupancyPct: maxPallets ? totalPallets / maxPallets : 0,
      totalVolumeM3,
      volumeOccupancyPct: maxVolume ? totalVolumeM3 / maxVolume : 0,
      distanceKm: estimate?.distanceKm,
      estimatedDurationMin: estimate ? Math.round(estimate.durationMin) : null,
    },
  });
}

// Tablero del planificador (Fase 5, Pantalla 4): pedidos validados pendientes de asignar
// a una ruta + rutas draft/optimized del almacén y fecha dados, con coordenadas listas
// para pintar en el mapa. Pensado para una sola llamada por carga de pantalla.
routesRouter.get(
  "/planner-board",
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const warehouseId = req.query.warehouseId as string | undefined;
    const date = req.query.date as string | undefined;
    // Fase 7b: filtro de servicio opcional -- ya no lo usa la pestaña
    // "Planificación" (Fase 8: ahora se ve la tipología de cada pedido como
    // etiqueta según su peso, en vez de obligar a elegir un único servicio
    // que ocultaba el resto de la lista), pero se mantiene por compatibilidad
    // con cualquier otro llamador. Sin este parámetro, todos los servicios
    // salen mezclados.
    const serviceType = req.query.serviceType as string | undefined;
    // Fase 8: "el sistema necesita poder reconocer fechas pasadas, sobre todo
    // para pruebas de funcionamiento" -- el bloqueo real no eran las fechas
    // (ninguna consulta ni el selector de fecha las restringían), sino que
    // esto exigía siempre status "validated": un pedido recién importado por
    // Excel o ERP entra como "received" y no aparecía aquí hasta validarlo
    // uno a uno. Ahora el estado es un filtro explícito, con "validated" como
    // valor por defecto (el mismo de siempre -- nada cambia si no se manda),
    // para poder elegir otro estado ex profeso al hacer pruebas.
    const status = (req.query.status as string | undefined) ?? "validated";

    const pendingOrders = await prisma.order.findMany({
      where: {
        companyId,
        status: status as any,
        ...(warehouseId ? { warehouseId } : {}),
        ...(date ? { requestedDeliveryDate: new Date(date) } : {}),
        ...(serviceType ? { serviceType: serviceType as any } : {}),
      },
      include: {
        customer: { select: { businessCode: true, legalName: true } },
        deliveryPoint: {
          select: { id: true, address: true, city: true, lat: true, lng: true, contactPhone: true, contactEmail: true },
        },
        warehouse: { select: { id: true, name: true, lat: true, lng: true } },
        lines: true,
      },
      orderBy: { priority: "desc" },
    });

    const routes = await prisma.route.findMany({
      where: {
        companyId,
        status: { in: ["draft", "optimized"] },
        ...(warehouseId ? { warehouseId } : {}),
        ...(date ? { routeDate: new Date(date) } : {}),
      },
      include: {
        warehouse: { select: { id: true, name: true, lat: true, lng: true } },
        loadPlan: true,
        stops: {
          orderBy: { sequence: "asc" },
          include: {
            order: {
              include: {
                customer: { select: { businessCode: true, legalName: true } },
                deliveryPoint: {
                  select: {
                    id: true,
                    address: true,
                    city: true,
                    lat: true,
                    lng: true,
                    contactPhone: true,
                    contactEmail: true,
                  },
                },
                lines: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Objetivo 2: sugerencia de tipo de vehículo por ruta, según su zona de
    // influencia (km estimados) y la carga total ya calculada en loadPlan.
    // Solo aplica a rutas que todavía no tienen vehículo asignado -- una vez
    // asignado, la ocupación real ya viene de ese vehículo concreto.
    const routesWithSuggestion = await Promise.all(
      routes.map(async (r) => {
        if (r.vehicleId || !r.loadPlan?.distanceKm) {
          return { ...r, suggestedVehicleType: null };
        }
        const suggestion = await suggestVehicleType({
          warehouseId: r.warehouseId,
          distanceKm: Number(r.loadPlan.distanceKm),
          totalWeightKg: Number(r.loadPlan.totalWeightKg),
          totalPallets: Number(r.loadPlan.totalPallets),
          totalVolumeM3: Number(r.loadPlan.totalVolumeM3),
        });
        return { ...r, suggestedVehicleType: suggestion };
      })
    );

    res.json({
      pendingOrders: pendingOrders.map((o) => ({
        ...o,
        totalWeightKg: o.lines.reduce((acc, l) => acc + Number(l.lineWeightKg ?? 0), 0),
      })),
      routes: routesWithSuggestion,
    });
  })
);

// Vista "Despacho" del Planificador (Fase 5b, estilo Bringg: tabla + mapa +
// Gantt). A diferencia de /planner-board (solo rutas draft/optimized,
// pensado para el tablero de arrastrar y soltar), esta trae TODAS las rutas
// del almacén/fecha dados sin importar su estado -- pensada para ver de un
// vistazo el despacho completo del día, incluidas las rutas que ya tienen
// transportista, conductor y envío en curso (con su última posición GPS
// conocida, mismo criterio que ya usa /shipments para Seguimiento).
routesRouter.get(
  "/dispatch-board",
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const warehouseId = req.query.warehouseId as string | undefined;
    const date = (req.query.date as string | undefined) ?? new Date().toISOString().slice(0, 10);

    const routes = await prisma.route.findMany({
      where: {
        companyId,
        routeDate: new Date(date),
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: {
        warehouse: { select: { id: true, name: true, lat: true, lng: true } },
        carrier: { select: { id: true, legalName: true } },
        vehicle: { select: { id: true, plate: true } },
        loadPlan: true,
        stops: {
          orderBy: { sequence: "asc" },
          include: {
            order: {
              select: {
                orderNumber: true,
                priority: true,
                deliveryTimeWindowFrom: true,
                deliveryTimeWindowTo: true,
                customer: { select: { legalName: true } },
                deliveryPoint: { select: { address: true, city: true, lat: true, lng: true, contactPhone: true } },
              },
            },
            // Fase 8O: hora REAL de entrega, para que la línea de tiempo del
            // Despacho pueda distinguir lo planificado (ETA) de lo que
            // realmente pasó -- antes solo movía un único punto, ya pintado
            // en la hora de la ETA, al color del estado actual, así que
            // nunca se veía si la entrega real fue antes/después de lo
            // previsto.
            pod: { select: { deliveredAt: true } },
          },
        },
        shipment: {
          select: {
            id: true,
            status: true,
            driverId: true,
            departedAt: true,
            driver: { select: { fullName: true, phone: true } },
            trackingEvents: {
              where: { lat: { not: null }, lng: { not: null } },
              orderBy: { occurredAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Pedidos validados de ese almacén/fecha que todavía no están en ninguna
    // ruta -- mismo criterio que /planner-board, para que la vista de
    // despacho también avise de lo que falta por planificar ese día.
    const unassignedOrdersCount = await prisma.order.count({
      where: {
        companyId,
        status: "validated",
        requestedDeliveryDate: new Date(date),
        ...(warehouseId ? { warehouseId } : {}),
      },
    });

    // Fase 6: geometría real de cada ruta (siguiendo carretera, vía
    // OpenRouteService) para pintarla en el mapa en vez de líneas rectas.
    // Reutiliza la misma cache por coordenadas que ya llena
    // recalculateLoadPlan -- si esa ruta se recalculó hace poco, esto no
    // gasta cuota extra. Sin clave ORS configurada, o si la llamada falla,
    // `geometry` queda en null y el mapa simplemente no dibuja esa línea.
    const itemsWithGeometry = await Promise.all(
      routes.map(async (r) => {
        const { shipment, ...rest } = r;
        const points = [
          r.warehouse?.lat != null && r.warehouse?.lng != null ? { lat: r.warehouse.lat, lng: r.warehouse.lng } : null,
          ...r.stops.map((s) =>
            s.order.deliveryPoint.lat != null && s.order.deliveryPoint.lng != null
              ? { lat: s.order.deliveryPoint.lat, lng: s.order.deliveryPoint.lng }
              : null
          ),
        ];
        const geometry = points.every((p) => p !== null) ? await getRouteGeometry(points as { lat: number; lng: number }[]) : null;
        if (!shipment) return { ...rest, shipment: null, geometry };
        const { trackingEvents, ...shipmentRest } = shipment;
        return { ...rest, shipment: { ...shipmentRest, lastPosition: trackingEvents[0] ?? null }, geometry };
      })
    );

    res.json({ items: itemsWithGeometry, unassignedOrdersCount });
  })
);

// Fase 6: planificación automática (motor de optimización VROOM vía
// OpenRouteService) -- agrupa y secuencia geográficamente los pedidos
// validados y todavía sin ruta de un almacén/fecha/servicio, creando rutas
// "draft" (sin transportista/vehículo concreto todavía, igual que si se
// hubieran montado a mano con "+ Nueva ruta"). La asignación de
// transportista/vehículo/conductor sigue siendo el flujo ya existente
// (RouteAssignmentModal / POST /optimization/:routeId/simulate) -- esto solo
// resuelve la parte que ese módulo documentaba como pendiente ("capa de
// secuenciación geográfica, a definir en integración").
//
// Como no hay todavía vehículos concretos asignables en esta fase del
// proceso, se usan "vehículos virtuales" del motor de optimización: uno por
// cada tipo de vehículo configurado en las zonas de influencia del almacén
// (o, si no hay ninguna configurada, los tipos de vehículo activos de la
// empresa), repetido varias veces para que el motor decida solo cuántas
// rutas hacen falta. Cada vehículo virtual sale y vuelve al almacén.
//
// Acotado a propósito para respetar la capa gratuita de ORS Optimization:
// como mucho MAX_JOBS pedidos y MAX_VEHICLES vehículos virtuales por
// llamada -- si hay más pedidos pendientes, se planifican los de mayor
// prioridad primero y el resto queda disponible para una siguiente pasada
// (mismo pedido, se puede volver a lanzar).
const MAX_AUTO_PLAN_JOBS = 45;
// Fase 8f: el límite de vehículos por llamada lo impone la cuenta de ORS
// contratada (ver env.orsMaxOptimizationVehicles) -- se probó con 18 y ORS
// respondió "Too many vehicles (18) in query, maximum is set to 3" (HTTP
// 413). Si en el futuro se amplía el plan de ORS, basta con subir
// ORS_MAX_OPTIMIZATION_VEHICLES en el entorno, sin tocar código.
const MAX_AUTO_PLAN_VEHICLES = env.orsMaxOptimizationVehicles;
// Fase 8g: con solo MAX_AUTO_PLAN_VEHICLES (3) vehículos por llamada, hace
// falta más de una llamada para dar cabida a todos los pedidos del grupo --
// ver el bucle de "pasadas" en el propio handler. Tope de seguridad para no
// encadenar llamadas indefinidamente si un pedido concreto no cabe en
// ningún vehículo (demasiado pesado/voluminoso, o sin ruta posible): a la
// pasada que no consiga asignar NADA se corta de todas formas antes de
// llegar aquí, así que este número solo protege ante el caso, más raro, de
// ir progresando muy poco a poco pedido a pedido.
const MAX_AUTO_PLAN_PASSES = 8;
const UNITS_PER_KG = 1; // capacidad en kg enteros
const UNITS_PER_PALLET = 10; // un decimal de precisión en palés (VROOM exige enteros)

function timeStringToSeconds(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 3600 + m * 60;
}

routesRouter.post(
  "/auto-plan",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      warehouseId: z.string().uuid(),
      routeDate: z.coerce.date(),
      // Fase 8: deja de ser obligatorio -- la pestaña "Planificación" ya no
      // fuerza a elegir un único servicio antes de poder ver/seleccionar
      // pedidos (eso ocultaba el resto de la lista). Si no se manda, cada
      // pedido seleccionado se planifica con SU PROPIO servicio (ya
      // calculado por peso/palés al crearlo -- ver classifyOrder), agrupando
      // en una ruta por cada servicio distinto que haya entre los
      // seleccionados. Si se manda (compatibilidad con cualquier otro
      // llamador), se comporta exactamente como antes: todo un único
      // servicio.
      serviceType: z.enum(["paqueteria", "paleteria", "paleteria_pesada", "gran_volumen"]).optional(),
      // Fase 8: mismo motivo que en /planner-board -- por defecto solo
      // pedidos "validated" (como siempre), pero se puede pedir otro estado
      // ex profeso para probar la planificación con pedidos recién
      // importados que todavía no se han validado uno a uno.
      status: z.string().optional(),
      // Fase 7b: la pestaña "Planificación" deja elegir con casillas qué
      // pedidos concretos entran en esta pasada (estilo Bringg: seleccionas
      // de la lista y le das a planificar). Si no se manda -- por
      // compatibilidad con cualquier otro llamador -- se sigue cogiendo
      // automáticamente por prioridad, exactamente como hasta ahora.
      orderIds: z.array(z.string().uuid()).optional(),
    });
    const data = schema.parse(req.body);
    const companyId = req.auth!.companyId;
    const status = data.status ?? "validated";

    const warehouse = await prisma.warehouse.findFirst({ where: { id: data.warehouseId, companyId } });
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado");
    if (warehouse.lat == null || warehouse.lng == null) {
      throw HttpError.badRequest("El almacén no tiene coordenadas -- añádelas antes de planificar automáticamente");
    }

    const pendingOrders = await prisma.order.findMany({
      where: {
        companyId,
        warehouseId: data.warehouseId,
        status: status as any,
        ...(data.serviceType ? { serviceType: data.serviceType } : {}),
        requestedDeliveryDate: data.routeDate,
        // Siempre acotado a este almacén/fecha/estado (no a cualquier id que
        // llegue en el body) -- así una selección manipulada o desactualizada
        // nunca puede colar un pedido de otra empresa, otro día o ya
        // planificado.
        ...(data.orderIds && data.orderIds.length > 0 ? { id: { in: data.orderIds } } : {}),
      },
      include: {
        deliveryPoint: { select: { lat: true, lng: true } },
        lines: { include: { product: { select: { unitsPerPallet: true } } } },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: MAX_AUTO_PLAN_JOBS + 50, // margen para poder informar de cuántos quedan fuera tras descartar sin coordenadas
    });

    const withCoords = pendingOrders.filter((o) => o.deliveryPoint.lat != null && o.deliveryPoint.lng != null);
    const withoutCoords = pendingOrders.length - withCoords.length;
    const selected = withCoords.slice(0, MAX_AUTO_PLAN_JOBS);
    const leftForNextRun = withCoords.length - selected.length;

    if (selected.length === 0) {
      return res.json({
        routesCreated: 0,
        ordersPlanned: 0,
        ordersUnassigned: 0,
        ordersWithoutCoords: withoutCoords,
        ordersLeftForNextRun: 0,
        message: "No hay pedidos con coordenadas para planificar en ese almacén/fecha/estado.",
      });
    }

    // Vehículos virtuales: tipos de vehículo de las zonas de influencia del
    // almacén (criterio ya usado en suggestVehicleType); si no hay ninguna
    // configurada, se cae a los tipos de vehículo activos de la empresa.
    // No depende del servicio, así que se calcula una sola vez para todos
    // los grupos. Ordenados de mayor a menor capacidad de peso: al haber
    // como mucho MAX_AUTO_PLAN_VEHICLES huecos por llamada a ORS, interesa
    // que los primeros vehículos "nuevos" que se creen sean los de más
    // capacidad -- así caben antes los pedidos grandes, que son los que
    // menos margen tienen para esperar a una pasada posterior.
    const zoneTypes = await prisma.influenceZone.findMany({
      where: { warehouseId: data.warehouseId },
      include: { vehicleType: true },
      distinct: ["vehicleTypeId"],
    });
    const vehicleTypes = (
      zoneTypes.length > 0 ? zoneTypes.map((zone) => zone.vehicleType) : await prisma.vehicleType.findMany()
    ).sort((a, b) => Number(b.maxWeightKg) - Number(a.maxWeightKg));

    if (vehicleTypes.length === 0) {
      throw HttpError.badRequest("No hay tipos de vehículo configurados con los que planificar rutas");
    }

    const warehouseCoord: [number, number] = [warehouse.lng, warehouse.lat];

    // Fase 8: una ruta solo puede tener un `serviceType` (columna de Route),
    // así que si la selección mezcla servicios distintos (posible ahora que
    // la pestaña "Planificación" ya no obliga a elegir uno antes de
    // seleccionar pedidos), se agrupan y se planifica cada grupo por
    // separado -- una o varias pasadas de VROOM y, como mucho, una o varias
    // rutas por grupo. Con `serviceType` explícito en el body (compatibilidad
    // con cualquier otro llamador) todo cae en un único grupo, igual que antes.
    const groups = new Map<string, typeof selected>();
    for (const order of selected) {
      // order.serviceType es opcional en el esquema (pedidos muy antiguos,
      // de antes del clasificador automático por peso/palés, podrían no
      // tenerlo relleno) -- se cae a "paleteria" como valor por defecto,
      // igual que ya hace el formulario manual de "+ Nueva ruta".
      const key = data.serviceType ?? order.serviceType ?? "paleteria";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(order);
    }

    const routesCreated: string[] = [];
    let ordersPlanned = 0;
    let ordersUnassigned = 0;
    const unassignedReasons: { orderNumber: string; reason: string }[] = [];

    // Fase 8g: "vehículo virtual" persistente entre pasadas de un mismo
    // grupo -- modela un vehículo/ruta que, si no se ha llenado del todo en
    // una pasada, puede seguir recibiendo más paradas en pasadas siguientes
    // (misma ruta, no una nueva) en vez de darse por agotado tras un único
    // intento. `capacity` es lo que le queda LIBRE, no su capacidad total.
    interface VehicleSlot {
      vroomId: number;
      capacity: [number, number];
      start: [number, number];
      routeId: string | null;
      stopCount: number;
    }

    for (const [groupServiceType, groupOrders] of groups) {
      // Pool de vehículos virtuales de ESTE grupo -- no se comparte entre
      // grupos (cada uno crea rutas de un servicio distinto, igual que ya
      // pasaba antes de esta fase). Empieza vacío: se van creando vehículos
      // nuevos solo a medida que hacen falta (ver dentro del bucle), nunca
      // más de los necesarios.
      const vehiclePool: VehicleSlot[] = [];
      let nextVroomId = 0;
      let typeCursor = 0;
      function spawnSlot(): VehicleSlot {
        const vt = vehicleTypes[typeCursor % vehicleTypes.length];
        typeCursor += 1;
        return {
          vroomId: nextVroomId++,
          capacity: [Math.round(Number(vt.maxWeightKg) * UNITS_PER_KG), Math.round(vt.maxPallets * UNITS_PER_PALLET)],
          start: warehouseCoord,
          routeId: null,
          stopCount: 0,
        };
      }

      // Pool de pedidos de este grupo aún sin asignar -- se va reduciendo a
      // medida que las pasadas consiguen encajarlos en algún vehículo.
      let remainingOrders = groupOrders;
      const lastReasonByOrderId = new Map<string, string>();

      for (let pass = 0; pass < MAX_AUTO_PLAN_PASSES && remainingOrders.length > 0; pass++) {
        // Hasta MAX_AUTO_PLAN_VEHICLES "huecos" por pasada (límite real de la
        // cuenta de ORS): primero se reutilizan vehículos ya usados en una
        // pasada anterior que todavía tengan capacidad libre -- así se les
        // van añadiendo más paradas a SU MISMA ruta en vez de abrir una
        // nueva -- y solo si faltan huecos se crean vehículos nuevos.
        const withRoom = vehiclePool.filter((v) => v.capacity[0] > 0 && v.capacity[1] > 0);
        const activeSlots: VehicleSlot[] = withRoom.slice(0, MAX_AUTO_PLAN_VEHICLES);
        while (activeSlots.length < MAX_AUTO_PLAN_VEHICLES) {
          const slot = spawnSlot();
          vehiclePool.push(slot);
          activeSlots.push(slot);
        }

        const passOrders = remainingOrders.slice(0, MAX_AUTO_PLAN_JOBS);
        const jobs: VroomJob[] = passOrders.map((order, idx) => {
          const weightKg = order.lines.reduce((acc, l) => acc + Number(l.lineWeightKg ?? 0), 0);
          const pallets = order.lines.reduce((acc, l) => {
            const upp = l.product.unitsPerPallet ?? 1;
            return acc + (upp > 0 ? Number(l.quantity) / upp : 0);
          }, 0);
          const fromSec = timeStringToSeconds(order.deliveryTimeWindowFrom);
          const toSec = timeStringToSeconds(order.deliveryTimeWindowTo);
          return {
            id: idx,
            location: [order.deliveryPoint.lng as number, order.deliveryPoint.lat as number],
            service: STOP_SERVICE_MINUTES * 60,
            delivery: [Math.round(weightKg * UNITS_PER_KG), Math.round(pallets * UNITS_PER_PALLET)],
            ...(fromSec != null && toSec != null ? { time_windows: [[fromSec, toSec]] as [number, number][] } : {}),
            priority: order.priority === "urgent" ? 100 : 0,
          };
        });
        const vroomVehicles: VroomVehicle[] = activeSlots.map((slot) => ({
          id: slot.vroomId,
          start: slot.start,
          end: warehouseCoord,
          capacity: slot.capacity,
          // Fase 8i: ver comentario en VroomVehicle -- sin esto ORS respondía
          // 400 "Invalid profile: car." al no mandar ninguno explícito.
          profile: env.orsProfile,
        }));

        let result;
        try {
          result = await optimizePlan({ jobs, vehicles: vroomVehicles });
        } catch (err) {
          if (err instanceof OrsNotConfiguredError) {
            throw HttpError.badRequest(
              "La planificación automática necesita una clave de OpenRouteService configurada (ORS_API_KEY) -- todavía no lo está."
            );
          }
          throw HttpError.badRequest(`No se pudo completar la optimización: ${(err as Error).message}`);
        }

        const assignedOrderIds = new Set<string>();

        for (const vroomRoute of result.routes) {
          const jobSteps = vroomRoute.steps.filter((s) => s.type === "job" && s.job != null);
          if (jobSteps.length === 0) continue;

          const slot = activeSlots.find((s) => s.vroomId === vroomRoute.vehicle);
          if (!slot) continue; // no debería pasar -- ORS devuelve el mismo id de vehículo que se le manda

          const stopOrderIds = jobSteps.map((step) => passOrders[step.job as number].id);

          const routeId: string = await prisma.$transaction(async (tx) => {
            let currentRouteId = slot.routeId;
            if (currentRouteId == null) {
              const created = await tx.route.create({
                data: {
                  companyId,
                  warehouseId: data.warehouseId,
                  routeDate: data.routeDate,
                  serviceType: groupServiceType as any,
                  status: "draft",
                },
              });
              currentRouteId = created.id;
            }
            await tx.routeStop.createMany({
              data: jobSteps.map((step, seqIdx) => ({
                routeId: currentRouteId as string,
                orderId: passOrders[step.job as number].id,
                sequence: slot.stopCount + seqIdx + 1,
              })),
            });
            await tx.order.updateMany({
              where: { id: { in: stopOrderIds } },
              data: { status: "planned" },
            });
            return currentRouteId as string;
          });

          const isNewRoute = slot.routeId == null;
          slot.routeId = routeId;
          slot.stopCount += jobSteps.length;

          // Capacidad restante y punto desde el que sigue para una posible
          // próxima pasada: continúa desde su última parada de esta pasada
          // en vez de volver al almacén -- no repite viaje, simplemente le
          // caben más paradas en la misma ruta si aún tiene sitio.
          const usedWeight = jobSteps.reduce((acc, step) => acc + (jobs[step.job as number].delivery?.[0] ?? 0), 0);
          const usedPallets = jobSteps.reduce((acc, step) => acc + (jobs[step.job as number].delivery?.[1] ?? 0), 0);
          slot.capacity = [slot.capacity[0] - usedWeight, slot.capacity[1] - usedPallets];
          const lastStep = jobSteps[jobSteps.length - 1];
          if (lastStep.location) slot.start = lastStep.location;

          await recalculateLoadPlan(routeId);
          if (isNewRoute) routesCreated.push(routeId);

          for (const id of stopOrderIds) assignedOrderIds.add(id);
        }

        for (const u of result.unassigned) {
          const order = passOrders[u.id];
          if (order) lastReasonByOrderId.set(order.id, u.reason ?? "sin especificar");
        }

        remainingOrders = remainingOrders.filter((o) => !assignedOrderIds.has(o.id));

        // Si esta pasada no ha conseguido colar NINGÚN pedido -- ni
        // reutilizando vehículos con hueco ni con vehículos nuevos -- más
        // pasadas no lo van a arreglar (el motivo es de capacidad/ruta, no
        // de cuántos vehículos se ofrecen). Se corta aquí para no gastar más
        // cuota de ORS en balde; lo que quede en remainingOrders pasa a
        // unassignedReasons más abajo.
        if (assignedOrderIds.size === 0) break;
      }

      ordersPlanned += groupOrders.length - remainingOrders.length;
      ordersUnassigned += remainingOrders.length;
      for (const order of remainingOrders) {
        unassignedReasons.push({
          orderNumber: order.orderNumber,
          reason: lastReasonByOrderId.get(order.id) ?? "No ha cabido en ningún vehículo tras varias pasadas",
        });
      }
    }

    broadcastToWarehouse(data.warehouseId, "auto_plan_completed", {
      warehouseId: data.warehouseId,
      routeDate: data.routeDate,
      routesCreated: routesCreated.length,
    });

    res.json({
      routesCreated: routesCreated.length,
      ordersPlanned,
      ordersUnassigned,
      ordersWithoutCoords: withoutCoords,
      ordersLeftForNextRun: leftForNextRun,
      unassignedReasons,
    });
  })
);

routesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const routeDate = req.query.date as string | undefined;
    const items = await prisma.route.findMany({
      where: {
        companyId: req.auth!.companyId,
        ...(status ? { status: status as any } : {}),
        ...(routeDate ? { routeDate: new Date(routeDate) } : {}),
      },
      include: {
        warehouse: { select: { name: true } },
        carrier: { select: { legalName: true } },
        vehicle: { select: { plate: true } },
        loadPlan: true,
        stops: { select: { id: true } },
      },
      orderBy: { routeDate: "desc" },
    });
    res.json({ items, total: items.length });
  })
);

routesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const route = await prisma.route.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
      include: {
        warehouse: true,
        carrier: true,
        vehicle: { include: { vehicleType: true } },
        loadPlan: true,
        stops: {
          orderBy: { sequence: "asc" },
          include: { order: { include: { deliveryPoint: true, customer: true, lines: true } } },
        },
        costSimulations: { include: { carrier: true, vehicleType: true }, orderBy: { estimatedCost: "asc" } },
        // Para que el modal de asignación sepa si ya existe un envío creado a
        // partir de esta ruta (y no ofrecer crear uno duplicado -- Shipment.routeId
        // es único) sin tener que consultar /shipments aparte.
        shipment: { select: { id: true, status: true, driverId: true } },
      },
    });
    if (!route) throw HttpError.notFound("Ruta no encontrada");
    res.json(route);
  })
);

routesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      warehouseId: z.string().uuid(),
      routeDate: z.coerce.date(),
      // Los 4 segmentos reales — ver el mismo comentario en orders.routes.ts.
      serviceType: z.enum(["paqueteria", "paleteria", "paleteria_pesada", "gran_volumen"]),
      orderIds: z.array(z.string().uuid()).min(1),
    });
    const data = schema.parse(req.body);

    const warehouse = await prisma.warehouse.findFirst({ where: { id: data.warehouseId, companyId: req.auth!.companyId } });
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado");

    const orders = await prisma.order.findMany({ where: { id: { in: data.orderIds }, companyId: req.auth!.companyId } });
    if (orders.length !== data.orderIds.length) throw HttpError.badRequest("Uno o más pedidos no existen");

    const route = await prisma.$transaction(async (tx) => {
      const created = await tx.route.create({
        data: {
          companyId: req.auth!.companyId,
          warehouseId: data.warehouseId,
          routeDate: data.routeDate,
          serviceType: data.serviceType,
          status: "draft",
        },
      });
      await tx.routeStop.createMany({
        data: data.orderIds.map((orderId, idx) => ({ routeId: created.id, orderId, sequence: idx + 1 })),
      });
      await tx.order.updateMany({ where: { id: { in: data.orderIds } }, data: { status: "planned" } });
      return created;
    });

    await recalculateLoadPlan(route.id);
    const full = await prisma.route.findUnique({ where: { id: route.id }, include: { stops: true, loadPlan: true } });
    res.status(201).json(full);
  })
);

routesRouter.post(
  "/:id/stops",
  asyncHandler(async (req, res) => {
    const schema = z.object({ orderId: z.string().uuid() });
    const { orderId } = schema.parse(req.body);

    const route = await prisma.route.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!route) throw HttpError.notFound("Ruta no encontrada");
    if (["confirmed", "in_progress", "closed"].includes(route.status)) {
      throw HttpError.conflict("No se puede modificar una ruta ya confirmada por el transportista");
    }

    const order = await prisma.order.findFirst({ where: { id: orderId, companyId: req.auth!.companyId } });
    if (!order) throw HttpError.notFound("Pedido no encontrado");

    const maxSeq = await prisma.routeStop.count({ where: { routeId: route.id } });
    await prisma.routeStop.create({ data: { routeId: route.id, orderId, sequence: maxSeq + 1 } });
    await prisma.order.update({ where: { id: orderId }, data: { status: "planned" } });

    await recalculateLoadPlan(route.id);
    const full = await prisma.route.findUnique({ where: { id: route.id }, include: { stops: true, loadPlan: true } });
    res.json(full);
  })
);

// Fase 8k: jornada laboral máxima (tacógrafo) -- petición de Raúl tras ver
// una ruta de prueba confirmada de 10:22 a 22:39 (más de 12h), que no es
// real. `warehouse`/`carrier` llegan tal cual del cliente Prisma; se leen
// con este helper en vez de acceso directo porque el cliente generado en
// este entorno de pruebas puede no incluir todavía el campo nuevo
// (maxRouteDurationHours) en su tipado -- el propio valor en base de datos
// sí existe una vez aplicado el schema. Si hay límite en almacén Y en
// transportista, se aplica el más restrictivo (el mínimo de los dos).
function resolveMaxRouteDurationHours(warehouse: unknown, carrier: unknown): number | null {
  const readHours = (entity: unknown): number | null => {
    const raw = (entity as { maxRouteDurationHours?: unknown } | null | undefined)?.maxRouteDurationHours;
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  };
  const candidates = [readHours(warehouse), readHours(carrier)].filter((h): h is number => h != null);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

routesRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      status: z.enum(["draft", "optimized", "assigned", "confirmed", "in_progress", "closed", "rejected"]),
      carrierId: z.string().uuid().optional(),
      vehicleId: z.string().uuid().optional(),
    });
    const data = schema.parse(req.body);

    const route = await prisma.route.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
      include: { warehouse: true, carrier: true, loadPlan: true },
    });
    if (!route) throw HttpError.notFound("Ruta no encontrada");

    // Fase 8k: se valida justo antes de confirmar -- es el punto de no
    // retorno antes de que la ruta sea visible/operativa para el
    // transportista/conductor. No se bloquean los pasos intermedios
    // (draft/optimized/assigned) para no entorpecer el trabajo de
    // planificación mientras se ajusta.
    if (data.status === "confirmed") {
      const effectiveCarrierId = data.carrierId ?? route.carrierId;
      const carrier =
        effectiveCarrierId && effectiveCarrierId !== route.carrier?.id
          ? await prisma.carrier.findUnique({ where: { id: effectiveCarrierId } })
          : route.carrier;
      const maxHours = resolveMaxRouteDurationHours(route.warehouse, carrier);
      const estimatedMin = route.loadPlan?.estimatedDurationMin;
      if (maxHours != null && estimatedMin != null) {
        const estimatedHours = Number(estimatedMin) / 60;
        if (estimatedHours > maxHours) {
          throw HttpError.badRequest(
            `La duración estimada de esta ruta (${estimatedHours.toFixed(1)} h) supera la jornada laboral máxima configurada (${maxHours} h) -- no se puede confirmar así. Ajusta la ruta o revisa el límite en Almacenes / Flota y Transportistas.`
          );
        }
      }
    }

    const updated = await prisma.route.update({
      where: { id: route.id },
      data: { status: data.status, carrierId: data.carrierId, vehicleId: data.vehicleId },
    });

    if (data.vehicleId) await recalculateLoadPlan(route.id);

    // Fase 6: aviso en vivo al despacho (vista Despacho / Tablero abiertos en
    // otras pestañas) de que el estado de esta ruta ha cambiado, sin esperar
    // a su próximo sondeo.
    broadcastToWarehouse(updated.warehouseId, "route_status_changed", {
      routeId: updated.id,
      status: updated.status,
    });

    res.json(updated);
  })
);

// Fase 8j: petición explícita de Raúl -- "debe poder eliminarse rutas
// creadas, por si se ha cometido algún error y que no se queden ahí fijas".
//
// Fase 8k: petición de ampliación -- "las rutas asignadas, también tienen
// que poder borrarse si han tenido algún error. Las únicas que no deberían
// poder borrarse son las que ya han sido entregadas a destino final". Se
// relaja el guard original: ya no basta con que exista un envío (Shipment)
// para bloquear el borrado -- ahora solo bloquea si ese envío ya está
// "finished" (entrega completa, pasa a formar parte del histórico real). Si
// el envío existe pero no está finalizado (programado, cargado o en
// reparto), se borra también él y todo lo que cuelga de él (incidencias,
// reclamaciones de retorno, líneas de liquidación, mensajes, eventos de
// seguimiento y albaranes digitales/POD de sus paradas) para poder borrar la
// ruta sin dejar registros huérfanos ni chocar con las restricciones de
// clave foránea de esas tablas. Los pedidos que llevaba la ruta vuelven a
// "validated" (pendientes de planificar) -- si no, se quedarían en
// "planned" apuntando a una ruta que ya no existe y desaparecerían para
// siempre del Planificador.
routesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const route = await prisma.route.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
      include: { stops: true, shipment: true },
    });
    if (!route) throw HttpError.notFound("Ruta no encontrada");

    if (route.shipment?.status === "finished") {
      throw HttpError.badRequest(
        "Esta ruta ya se entregó por completo a destino final -- no se puede eliminar, forma parte del histórico."
      );
    }

    const stopIds = route.stops.map((s: { id: string }) => s.id);
    const orderIds = route.stops.map((s: { orderId: string }) => s.orderId);
    const shipmentId = route.shipment?.id;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (shipmentId) {
        // Se borra primero todo lo que cuelga del envío -- estas tablas no
        // tienen onDelete: Cascade hacia shipment/route_stop en el schema,
        // así que dejarlas intactas haría fallar el borrado de la ruta (o
        // dejaría registros huérfanos apuntando a una parada/envío que ya no
        // existe).
        if (stopIds.length > 0) {
          await tx.proofOfDelivery.deleteMany({ where: { routeStopId: { in: stopIds } } });
        }
        await tx.incident.deleteMany({ where: { shipmentId } });
        await tx.returnClaim.deleteMany({ where: { shipmentId } });
        await tx.settlementLine.deleteMany({ where: { shipmentId } });
        await tx.shipmentMessage.deleteMany({ where: { shipmentId } });
        await tx.trackingEvent.deleteMany({ where: { shipmentId } });
        await tx.shipment.delete({ where: { id: shipmentId } });
      }

      if (orderIds.length > 0) {
        await tx.order.updateMany({ where: { id: { in: orderIds } }, data: { status: "validated" } });
      }
      await tx.costSimulation.deleteMany({ where: { routeId: route.id } });
      await tx.loadPlan.deleteMany({ where: { routeId: route.id } });
      // routeStop tiene onDelete: Cascade hacia route en el schema, así que
      // el propio delete de la ruta ya se encarga de borrar sus paradas.
      await tx.route.delete({ where: { id: route.id } });
    });

    broadcastToWarehouse(route.warehouseId, "route_status_changed", { routeId: route.id, status: "deleted" });

    res.status(204).send();
  })
);
