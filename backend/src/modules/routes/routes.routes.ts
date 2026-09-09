import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
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

    const pendingOrders = await prisma.order.findMany({
      where: {
        companyId,
        status: "validated",
        ...(warehouseId ? { warehouseId } : {}),
        ...(date ? { requestedDeliveryDate: new Date(date) } : {}),
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
          },
        },
        shipment: {
          select: {
            id: true,
            status: true,
            driverId: true,
            departedAt: true,
            driver: { select: { fullName: true } },
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
const MAX_AUTO_PLAN_VEHICLES = 18;
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
      serviceType: z.enum(["paqueteria", "paleteria", "paleteria_pesada", "gran_volumen"]),
    });
    const data = schema.parse(req.body);
    const companyId = req.auth!.companyId;

    const warehouse = await prisma.warehouse.findFirst({ where: { id: data.warehouseId, companyId } });
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado");
    if (warehouse.lat == null || warehouse.lng == null) {
      throw HttpError.badRequest("El almacén no tiene coordenadas -- añádelas antes de planificar automáticamente");
    }

    const pendingOrders = await prisma.order.findMany({
      where: {
        companyId,
        warehouseId: data.warehouseId,
        status: "validated",
        serviceType: data.serviceType,
        requestedDeliveryDate: data.routeDate,
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
        message: "No hay pedidos validados con coordenadas para planificar en ese almacén/fecha/servicio.",
      });
    }

    // Vehículos virtuales: tipos de vehículo de las zonas de influencia del
    // almacén (criterio ya usado en suggestVehicleType); si no hay ninguna
    // configurada, se cae a los tipos de vehículo activos de la empresa.
    const zoneTypes = await prisma.influenceZone.findMany({
      where: { warehouseId: data.warehouseId },
      include: { vehicleType: true },
      distinct: ["vehicleTypeId"],
    });
    const vehicleTypes =
      zoneTypes.length > 0
        ? zoneTypes.map((zone) => zone.vehicleType)
        : await prisma.vehicleType.findMany({ take: 3 });

    if (vehicleTypes.length === 0) {
      throw HttpError.badRequest("No hay tipos de vehículo configurados con los que planificar rutas");
    }

    const warehouseCoord: [number, number] = [warehouse.lng, warehouse.lat];
    const vehicles: VroomVehicle[] = [];
    let vehicleIdx = 0;
    // Como mucho tantas unidades por tipo como hagan falta para poder cubrir
    // todos los pedidos seleccionados en el peor caso (uno por vehículo),
    // repartidas entre los tipos disponibles, sin pasar del límite global.
    const unitsPerType = Math.max(1, Math.ceil(MAX_AUTO_PLAN_VEHICLES / vehicleTypes.length));
    for (const vt of vehicleTypes) {
      for (let i = 0; i < unitsPerType && vehicles.length < MAX_AUTO_PLAN_VEHICLES; i++) {
        vehicles.push({
          id: vehicleIdx++,
          start: warehouseCoord,
          end: warehouseCoord,
          capacity: [
            Math.round(Number(vt.maxWeightKg) * UNITS_PER_KG),
            Math.round(vt.maxPallets * UNITS_PER_PALLET),
          ],
        });
      }
    }

    const jobs: VroomJob[] = selected.map((order, idx) => {
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

    let result;
    try {
      result = await optimizePlan({ jobs, vehicles });
    } catch (err) {
      if (err instanceof OrsNotConfiguredError) {
        throw HttpError.badRequest(
          "La planificación automática necesita una clave de OpenRouteService configurada (ORS_API_KEY) -- todavía no lo está."
        );
      }
      throw HttpError.badRequest(`No se pudo completar la optimización: ${(err as Error).message}`);
    }

    const routesCreated: string[] = [];
    for (const vroomRoute of result.routes) {
      const jobSteps = vroomRoute.steps.filter((s) => s.type === "job" && s.job != null);
      if (jobSteps.length === 0) continue;

      const route = await prisma.$transaction(async (tx) => {
        const created = await tx.route.create({
          data: {
            companyId,
            warehouseId: data.warehouseId,
            routeDate: data.routeDate,
            serviceType: data.serviceType,
            status: "draft",
          },
        });
        await tx.routeStop.createMany({
          data: jobSteps.map((step, seqIdx) => ({
            routeId: created.id,
            orderId: selected[step.job as number].id,
            sequence: seqIdx + 1,
          })),
        });
        await tx.order.updateMany({
          where: { id: { in: jobSteps.map((step) => selected[step.job as number].id) } },
          data: { status: "planned" },
        });
        return created;
      });

      await recalculateLoadPlan(route.id);
      routesCreated.push(route.id);
    }

    broadcastToWarehouse(data.warehouseId, "auto_plan_completed", {
      warehouseId: data.warehouseId,
      routeDate: data.routeDate,
      routesCreated: routesCreated.length,
    });

    res.json({
      routesCreated: routesCreated.length,
      ordersPlanned: jobs.length - result.unassigned.length,
      ordersUnassigned: result.unassigned.length,
      ordersWithoutCoords: withoutCoords,
      ordersLeftForNextRun: leftForNextRun,
      unassignedReasons: result.unassigned.map((u) => ({
        orderNumber: selected[u.id]?.orderNumber ?? "?",
        reason: u.reason ?? "sin especificar",
      })),
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

routesRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      status: z.enum(["draft", "optimized", "assigned", "confirmed", "in_progress", "closed", "rejected"]),
      carrierId: z.string().uuid().optional(),
      vehicleId: z.string().uuid().optional(),
    });
    const data = schema.parse(req.body);

    const route = await prisma.route.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!route) throw HttpError.notFound("Ruta no encontrada");

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
