import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { estimateRoute, suggestVehicleType } from "@/modules/routing/routing.service";

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

    res.json(updated);
  })
);
