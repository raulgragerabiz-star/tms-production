// NOTA: el motor de optimización completo (Fase 8) usa VRP/heurísticas de secuenciación
// geográfica; aquí se implementa la capa de generación de candidatos + cálculo de coste
// (capas 1 y 2 de la Fase 8), que es la parte determinista y ya ejecutable sin dependencias
// de mapas externos. La capa de secuenciación geográfica se conecta cuando se integre un
// proveedor de rutas (Fase 7, "a definir en integración").
import { Router } from "express";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { resolveShipmentCost } from "@/modules/rates/rate-resolution.service";

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

    const carriers = await prisma.carrier.findMany({
      where: {
        companyId: req.auth!.companyId,
        active: true,
        OR: [{ serviceType: route.serviceType as any }, { serviceType: "both" }],
      },
    });

    // Si todas las paradas comparten un único cliente, se propaga a la resolución para
    // que una eventual tarifa `by_customer` pueda ganar prioridad (Fase 9). Igual con la
    // provincia: si todas las paradas caen en la misma, se habilita `by_zone`.
    const customerIds = new Set(route.stops.map((s) => s.order.customerId));
    const singleCustomerId = customerIds.size === 1 ? [...customerIds][0] : undefined;
    const provinces = new Set(route.stops.map((s) => s.order.deliveryPoint.province).filter(Boolean));
    const singleProvince = provinces.size === 1 ? ([...provinces][0] as string) : undefined;

    const results = [];
    for (const carrier of carriers) {
      const resolved = await resolveShipmentCost({
        carrierId: carrier.id,
        serviceType: route.serviceType as "full_truck" | "pallet",
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
          carrierId: carrier.id,
          estimatedCost: resolved.estimatedCost,
          costBreakdown: resolved.breakdown as any,
        },
      });
      results.push(sim);
    }

    if (results.length === 0) throw HttpError.badRequest("Ningún transportista tiene tarifa vigente para esta fecha/servicio");

    results.sort((a, b) => Number(a.estimatedCost) - Number(b.estimatedCost));
    await prisma.route.update({ where: { id: route.id }, data: { status: "optimized" } });

    res.json({ routeId: route.id, candidates: results });
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
      prisma.route.update({ where: { id: sim.routeId }, data: { carrierId: sim.carrierId, status: "assigned" } }),
    ]);

    res.json({ ok: true });
  })
);
