// NOTA: el motor de optimización completo (Fase 8) usa VRP/heurísticas de secuenciación
// geográfica; aquí se implementa la capa de generación de candidatos + cálculo de coste
// (capas 1 y 2 de la Fase 8), que es la parte determinista y ya ejecutable sin dependencias
// de mapas externos. La capa de secuenciación geográfica se conecta cuando se integre un
// proveedor de rutas (Fase 7, "a definir en integración").
//
// CAMBIO (reconexión del motor, v1.1): la generación de candidatos usaba
// `carrier.serviceType` (enum CarrierServiceType: full_truck/pallet/both)
// comparado directamente contra `route.serviceType` (enum ServiceType: los 4
// segmentos paqueteria/paleteria/paleteria_pesada/gran_volumen) — dos enums de
// Postgres distintos que nunca pueden coincidir por valor, así que ese filtro
// no devolvía nunca resultados (o directamente fallaba la consulta). Se
// sustituye por el criterio que sí describe docs/09-motor-optimizacion-TMS.md
// para la capa 1: candidatos = transportistas con al menos un vehículo cuyo
// `vehicle_type` cubre la ocupación real de la ruta (peso y palés del
// load_plan, respetando `allows_exceeding_pallets`) — exactamente "en base a
// pesos, palets, rutas" tal y como se pidió.
import { Router } from "express";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { resolveShipmentCost } from "@/modules/rates/rate-resolution.service";
import { recalculateLoadPlan } from "./routes.routes";
import { attemptAutoAssign } from "@/modules/intelligence/auto-optimization.orchestrator";

export const optimizationRouter = Router();

optimizationRouter.post(
  "/:routeId/simulate",
  asyncHandler(async (req, res) => {
    const route = await prisma.route.findFirst({
      where: { id: req.params.routeId, companyId: req.auth!.companyId },
      include: {
        loadPlan: true,
        stops: { include: { order: { include: { deliveryPoint: true } } } },
      },
    });
    if (!route) throw HttpError.notFound("Ruta no encontrada");
    if (route.stops.length === 0) throw HttpError.badRequest("La ruta no tiene paradas asignadas todavía");

    // El load plan (peso/palés totales) se recalcula aquí en vez de asumir que
    // ya está actualizado — evita candidatos calculados sobre una ocupación
    // obsoleta si se añadieron/quitaron paradas sin pasar por recalculateLoadPlan.
    await recalculateLoadPlan(route.id);
    const loadPlan = await prisma.loadPlan.findUnique({ where: { routeId: route.id } });
    const totalWeightKg = Number(loadPlan?.totalWeightKg ?? 0);
    const totalPallets = Number(loadPlan?.totalPallets ?? 0);

    // Capa 1 (candidatos): vehículos activos de la empresa cuyo tipo cubre el
    // peso y los palés de la ruta. Si el vehículo permite exceder palés
    // (allows_exceeding_pallets), el límite de palés se ignora siempre que el
    // peso siga cubierto — mismo criterio que docs/09 §"candidate generation".
    const candidateVehicles = await prisma.vehicle.findMany({
      where: {
        active: true,
        carrier: { companyId: req.auth!.companyId, active: true },
        vehicleType: { maxWeightKg: { gte: totalWeightKg } },
      },
      include: { vehicleType: true, carrier: true },
    });

    const qualifyingByCarrier = new Map<string, { carrierId: string; vehicleTypeId: string }>();
    for (const vehicle of candidateVehicles) {
      const fitsPallets =
        vehicle.vehicleType.allowsExceedingPallets || vehicle.vehicleType.maxPallets >= totalPallets;
      if (!fitsPallets) continue;
      // Un transportista puede tener varios vehículos que cubran la ruta; nos
      // quedamos con uno por transportista (la tarifa se resuelve por
      // transportista, no por vehículo concreto).
      if (!qualifyingByCarrier.has(vehicle.carrierId)) {
        qualifyingByCarrier.set(vehicle.carrierId, { carrierId: vehicle.carrierId, vehicleTypeId: vehicle.vehicleTypeId });
      }
    }

    if (qualifyingByCarrier.size === 0) {
      throw HttpError.badRequest(
        `Ningún transportista tiene un vehículo con capacidad suficiente (${totalWeightKg}kg / ${totalPallets.toFixed(2)} palés)`
      );
    }

    // Si todas las paradas comparten un único cliente, se propaga a la resolución para
    // que una eventual tarifa `by_customer` pueda ganar prioridad. Igual con la
    // provincia: si todas las paradas caen en la misma, se habilita `by_zone`.
    const customerIds = new Set(route.stops.map((s) => s.order.customerId));
    const singleCustomerId = customerIds.size === 1 ? [...customerIds][0] : undefined;
    const provinces = new Set(route.stops.map((s) => s.order.deliveryPoint.province).filter(Boolean));
    const singleProvince = provinces.size === 1 ? ([...provinces][0] as string) : undefined;

    const results = [];
    for (const { carrierId, vehicleTypeId } of qualifyingByCarrier.values()) {
      const resolved = await resolveShipmentCost({
        carrierId,
        serviceType: route.serviceType,
        date: route.routeDate,
        stops: route.stops.length,
        notesCount: route.stops.length,
        customerId: singleCustomerId,
        province: singleProvince,
      });
      if (!resolved) continue;

      const sim = await prisma.costSimulation.create({
        data: {
          routeId: route.id,
          carrierId,
          vehicleTypeId,
          estimatedCost: resolved.estimatedCost,
          costBreakdown: resolved.breakdown as any,
        },
      });
      results.push(sim);
    }

    if (results.length === 0) {
      throw HttpError.badRequest(
        "Hay transportistas con capacidad suficiente pero ninguno tiene tarifa vigente para esta fecha/servicio"
      );
    }

    results.sort((a, b) => Number(a.estimatedCost) - Number(b.estimatedCost));
    await prisma.route.update({ where: { id: route.id }, data: { status: "optimized" } });

    // Motor de inteligencia (3/3): si la empresa tiene activada la
    // auto-asignación (Configuración, apagada por defecto), se evalúa aquí
    // mismo si el mejor candidato es lo bastante bueno para asignarlo solo
    // -- justo el punto en el que ya existen los cost_simulation recién
    // creados. Envuelto en try/catch a propósito: es una capa opcional
    // sobre la comparativa manual que ya funcionaba antes de esta pieza, un
    // fallo aquí nunca debe impedir que /simulate devuelva sus candidatos.
    let autoAssign;
    try {
      autoAssign = await attemptAutoAssign(route.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[auto-optimization] fallo evaluando auto-asignación", err);
      autoAssign = { autoAssigned: false, routeId: route.id, confidence: null, reason: "auto_assign_error" };
    }

    res.json({ routeId: route.id, totalWeightKg, totalPallets, candidates: results, autoAssign });
  })
);

optimizationRouter.post(
  "/:routeId/select/:costSimulationId",
  asyncHandler(async (req, res) => {
    const sim = await prisma.costSimulation.findFirst({
      where: { id: req.params.costSimulationId, routeId: req.params.routeId, route: { companyId: req.auth!.companyId } },
    });
    if (!sim) throw HttpError.notFound("Simulación no encontrada");

    await prisma.$transaction([
      prisma.costSimulation.updateMany({ where: { routeId: sim.routeId }, data: { isSelected: false } }),
      prisma.costSimulation.update({ where: { id: sim.id }, data: { isSelected: true } }),
      prisma.route.update({
        where: { id: sim.routeId },
        data: { carrierId: sim.carrierId, status: "assigned" },
      }),
    ]);

    res.json({ ok: true });
  })
);
