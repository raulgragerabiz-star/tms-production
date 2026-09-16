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
import { resolveDeliveryZonesForPairs, zonePairKey } from "@/modules/customers/customer-zone-resolution";

export const optimizationRouter = Router();

optimizationRouter.post(
  "/:routeId/simulate",
  asyncHandler(async (req, res) => {
    const route = await prisma.route.findFirst({
      where: { id: req.params.routeId, companyId: req.auth!.companyId },
      include: {
        loadPlan: true,
        // Fase 8Q: se añade `lines: { include: { product: true } }` al pedido
        // de cada parada -- hace falta para saber si algún producto de la
        // ruta exige frío o ADR, y así poder filtrar candidatos por esas
        // características reales del vehículo (ver más abajo). Aditivo: el
        // resto de campos ya incluidos (deliveryPoint) no cambian.
        // Fase 8T: se añade `customer: { select: { deliveryZoneId: true } } }`
        // -- hace falta para saber si todas las paradas de la ruta pertenecen
        // al mismo circuito de reparto (ver singleDeliveryZoneId más abajo) y
        // así poder aplicar la tarifa por circuito+vehículo. Aditivo: el
        // resto de campos ya incluidos no cambian.
        stops: {
          include: {
            order: {
              include: {
                deliveryPoint: true,
                lines: { include: { product: true } },
                customer: { select: { deliveryZoneId: true } },
              },
            },
          },
        },
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

    // Fase 8Q -- "completar la BD de vehículos... y que estas características
    // constriñan/filtren candidatos, no solo existan como datos sueltos"
    // (petición explícita de Raúl). Se agregan aquí, UNA sola vez para toda
    // la ruta, los requisitos especiales de sus pedidos/líneas: si CUALQUIER
    // parada exige frío/ADR/grúa/plataforma, la ruta entera hereda esa
    // exigencia (no tendría sentido asignar un vehículo que no pueda atender
    // una de las paradas). `routeDistanceKm` viene del load plan recién
    // recalculado arriba; 0/null significa "todavía sin distancia calculada"
    // y por tanto no se aplica ninguna restricción de radio de acción.
    const routeRequiresCold = route.stops.some((s: any) => s.order.lines.some((l: any) => l.product.requiresCold));
    const routeRequiresAdr = route.stops.some((s: any) => s.order.lines.some((l: any) => l.product.requiresAdr));
    const routeRequiresCrane = route.stops.some((s: any) => s.order.requiresCrane);
    const routeRequiresLiftgate = route.stops.some((s: any) => s.order.requiresLiftgate);
    const routeDistanceKm = Number(loadPlan?.distanceKm ?? 0);

    // Comprueba las características reales del vehículo (matrícula concreta,
    // NUNCA la oferta declarada sin matricular -- ver comentario más abajo en
    // `declaredOfferings`) contra los requisitos agregados de la ruta.
    // Cualquier campo del vehículo que esté sin rellenar (null) se trata como
    // "sin restricción" para esa característica en concreto, igual que ya
    // hace el resto del motor con los campos opcionales existentes.
    function vehicleMeetsSpecialRequirements(vehicle: { workingTemperature: string }): boolean {
      const v = vehicle as any;
      if (routeRequiresCold && !["refrigerated", "frozen", "mixed"].includes(vehicle.workingTemperature)) return false;
      if (routeRequiresAdr && !v.hasAdr) return false;
      if (routeRequiresCrane && !v.hasCrane) return false;
      if (routeRequiresLiftgate && !v.hasLiftgate) return false;
      if (v.actionRadiusKm != null && routeDistanceKm > 0 && Number(v.actionRadiusKm) < routeDistanceKm) return false;
      return true;
    }

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
      // Fase 8Q: frío/ADR/grúa/plataforma/radio de acción -- restricción dura
      // real, no solo dato informativo (ver función más arriba).
      if (!vehicleMeetsSpecialRequirements(vehicle)) continue;
      // Un transportista puede tener varios vehículos que cubran la ruta; nos
      // quedamos con uno por transportista (la tarifa se resuelve por
      // transportista, no por vehículo concreto).
      if (!qualifyingByCarrier.has(vehicle.carrierId)) {
        qualifyingByCarrier.set(vehicle.carrierId, { carrierId: vehicle.carrierId, vehicleTypeId: vehicle.vehicleTypeId });
      }
    }

    // Fase 8j: bug real reportado por Raúl -- "el planificador automático
    // dice que ningún transportista tiene capacidad suficiente pese a haber
    // vehículos configurados con hasta 33 palés". La causa: el bloque de
    // arriba solo mira `Vehicle` (matrículas concretas dadas de alta), pero
    // en "Flota y Transportistas" un transportista puede simplemente
    // *declarar* qué tipos de vehículo puede aportar sin llegar a registrar
    // ninguna matrícula todavía (checkboxes -- ver CarrierVehicleType /
    // TransportistasTab.tsx). Antes esos transportistas nunca contaban como
    // candidatos aquí, aunque el tipo declarado cubriera de sobra el peso y
    // los palés de la ruta. Se añaden ahora como candidatos de refuerzo (solo
    // si el transportista no tiene ya un vehículo real que cubra la ruta, que
    // sigue teniendo prioridad).
    //
    // Fase 8Q -- decisión deliberada de alcance: las nuevas restricciones de
    // frío/ADR/grúa/plataforma/radio de acción NO se aplican a este fallback.
    // Son características de una MATRÍCULA física concreta (Vehicle), y
    // `CarrierVehicleType` es justo lo contrario -- un transportista que
    // declara "puedo aportar este tipo de vehículo" sin tener aún ninguna
    // matrícula real dada de alta. Exigir aquí "¿ese vehículo (que todavía no
    // existe) lleva ADR?" sería inventar un dato que nadie ha declarado. Este
    // fallback sigue filtrando solo por peso/palés, exactamente igual que
    // antes de esta fase.
    const declaredOfferings = await prisma.carrierVehicleType.findMany({
      where: {
        carrier: { companyId: req.auth!.companyId, active: true },
        vehicleType: { maxWeightKg: { gte: totalWeightKg } },
      },
      include: { vehicleType: true },
    });
    for (const offering of declaredOfferings) {
      if (qualifyingByCarrier.has(offering.carrierId)) continue;
      const fitsPallets =
        offering.vehicleType.allowsExceedingPallets || offering.vehicleType.maxPallets >= totalPallets;
      if (!fitsPallets) continue;
      qualifyingByCarrier.set(offering.carrierId, {
        carrierId: offering.carrierId,
        vehicleTypeId: offering.vehicleTypeId,
      });
    }

    if (qualifyingByCarrier.size === 0) {
      throw HttpError.badRequest(
        `Ningún transportista tiene un vehículo con capacidad suficiente (${totalWeightKg}kg / ${totalPallets.toFixed(2)} palés)`
      );
    }

    // Si todas las paradas comparten un único cliente, se propaga a la resolución para
    // que una eventual tarifa `by_customer` pueda ganar prioridad. Igual con la
    // provincia: si todas las paradas caen en la misma, se habilita `by_zone`.
    const customerIds = new Set(route.stops.map((s: any) => s.order.customerId as string));
    const singleCustomerId: string | undefined = customerIds.size === 1 ? [...customerIds][0] : undefined;
    const provinces = new Set(route.stops.map((s: any) => s.order.deliveryPoint.province).filter(Boolean));
    const singleProvince = provinces.size === 1 ? ([...provinces][0] as string) : undefined;
    // Fase 8T: igual criterio que singleCustomerId/singleProvince -- nada en
    // el modelo obliga a que una ruta tenga paradas de un solo circuito de
    // reparto, así que solo se propaga cuando de verdad coinciden todas (en
    // caso contrario, se degrada a undefined y ese nivel de tarifa se salta,
    // igual que ya hacen los otros dos).
    //
    // Fase 15: el circuito de cada parada ya NO se lee directamente de
    // `customer.deliveryZoneId` -- un cliente puede tener un circuito
    // distinto según el almacén desde el que se le sirva (ver
    // CustomerDeliveryZone / customer-zone-resolution.ts), y esta ruta parte
    // siempre de un único almacén (`route.warehouseId`). Se resuelve el
    // circuito EFECTIVO de cada parada para ese almacén antes de comprobar si
    // todas coinciden.
    const stopZoneMap = await resolveDeliveryZonesForPairs(
      route.stops.map((s: any) => ({ customerId: s.order.customerId as string, warehouseId: route.warehouseId }))
    );
    const deliveryZoneIds = new Set(
      route.stops
        .map((s: any) => stopZoneMap.get(zonePairKey(s.order.customerId, route.warehouseId))?.id)
        .filter((id: string | undefined): id is string => !!id)
    );
    const singleDeliveryZoneId = deliveryZoneIds.size === 1 ? ([...deliveryZoneIds][0] as string) : undefined;

    // Fase 14: nombres de los transportistas candidatos -- hace falta para
    // poder identificar en la respuesta a los que se quedan SIN tarifa
    // vigente (ver `unresolvedCandidates` más abajo), no solo a los que sí
    // consiguen un coste.
    const candidateCarrierNames = new Map(
      (
        await prisma.carrier.findMany({
          where: { id: { in: [...qualifyingByCarrier.keys()] } },
          select: { id: true, legalName: true },
        })
      ).map((c: any) => [c.id, c.legalName])
    );

    const results = [];
    // Fase 14: bug real reportado por Raúl -- "da error y no llega a
    // mostrar lista de tte con costes". Causa encontrada por revisión de
    // código (sin acceso a la base de datos real para reproducirlo): si
    // las paradas de la ruta pertenecen a más de un circuito de reparto (o
    // a clientes sin circuito asignado todavía), `singleDeliveryZoneId`
    // queda `undefined` y la tarifa por circuito+vehículo se salta para
    // TODOS los candidatos -- si además ninguno tiene tampoco tarifa
    // general (`by_zone`/`full_truck_rate`/`pallet_rate`) configurada como
    // respaldo (caso habitual aquí, donde Raúl solo ha dado de alta
    // tarifas por circuito en "Flota y Transportistas"), `resolved` sale
    // `null` para todos y antes esto lanzaba un `HttpError.badRequest` que
    // cortaba la respuesta entera: el frontend mostraba un error y nunca
    // llegaba a pintar la lista de transportistas con capacidad. Se
    // sustituye por una respuesta 200 con la lista de candidatos sin coste
    // calculable (`unresolvedCandidates`), para que el comparador pueda
    // mostrarlos igualmente con el motivo ("sin tarifa vigente") en vez de
    // una pantalla de error -- y Raúl pueda revisar el circuito/tarifa que
    // falta en vez de quedarse sin ninguna información.
    const unresolvedCandidates: Array<{ carrierId: string; legalName: string; vehicleTypeId: string; reason: string }> = [];
    for (const { carrierId, vehicleTypeId } of qualifyingByCarrier.values()) {
      const resolved = await resolveShipmentCost({
        carrierId,
        serviceType: route.serviceType,
        date: route.routeDate,
        stops: route.stops.length,
        notesCount: route.stops.length,
        customerId: singleCustomerId,
        province: singleProvince,
        // Fase 8T: tarifa por circuito+vehículo -- vehicleTypeId es el del
        // candidato concreto de esta iteración (real de Vehicle, o declarado
        // vía CarrierVehicleType), exactamente el que se aplicaría "al hacer
        // el enrutado" si se selecciona este transportista.
        deliveryZoneId: singleDeliveryZoneId,
        vehicleTypeId,
        weightKg: totalWeightKg,
      });
      if (!resolved) {
        unresolvedCandidates.push({
          carrierId,
          legalName: candidateCarrierNames.get(carrierId) ?? carrierId,
          vehicleTypeId,
          reason: singleDeliveryZoneId
            ? "Sin tarifa vigente para este transportista/vehículo en la fecha de la ruta"
            : "Las paradas de la ruta pertenecen a más de un circuito de reparto (o a clientes sin circuito asignado), y no hay tarifa general de respaldo configurada",
        });
        continue;
      }

      const sim = await prisma.costSimulation.create({
        data: {
          routeId: route.id,
          carrierId,
          vehicleTypeId,
          estimatedCost: resolved.estimatedCost,
          estimatedMargin: resolved.estimatedMargin,
          costBreakdown: resolved.breakdown as any,
        },
      });
      results.push(sim);
    }

    if (results.length === 0) {
      // Se documenta el motivo más probable (ver comentario más arriba) en
      // vez de cortar la respuesta -- así el comparador puede mostrar por
      // qué ningún transportista tiene coste, en lugar de una pantalla de
      // error sin ninguna pista.
      res.json({
        routeId: route.id,
        totalWeightKg,
        totalPallets,
        candidates: [],
        unresolvedCandidates,
        autoAssign: null,
        noValidRateReason: singleDeliveryZoneId
          ? "Hay transportistas con capacidad suficiente pero ninguno tiene tarifa vigente para esta fecha/servicio"
          : "Las paradas de esta ruta pertenecen a más de un circuito de reparto -- no se puede aplicar la tarifa por circuito+vehículo y no hay tarifa general configurada como respaldo",
      });
      return;
    }

    // Fase 14: petición de Raúl -- "ofreciendo visión de coste vs beneficio...
    // para ver cuál sería el más rentable". El candidato más rentable
    // (mayor beneficio de empresa) va primero; sin beneficio calculable
    // (tarifa que no viene de circuito+vehículo) se ordena al final, y entre
    // esos el criterio sigue siendo el coste más bajo, como antes de esta
    // fase.
    results.sort((a, b) => {
      const marginA = a.estimatedMargin != null ? Number(a.estimatedMargin) : -Infinity;
      const marginB = b.estimatedMargin != null ? Number(b.estimatedMargin) : -Infinity;
      if (marginA !== marginB) return marginB - marginA;
      return Number(a.estimatedCost) - Number(b.estimatedCost);
    });
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

    res.json({ routeId: route.id, totalWeightKg, totalPallets, candidates: results, unresolvedCandidates, autoAssign });
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
