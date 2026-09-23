import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { resolveDeliveryZonesForPairs } from "@/modules/customers/customer-zone-resolution";
import { haversineKm, RoutePoint } from "@/modules/routing/routing.service";
// Fase 19: extraído a @/lib/distance-tiers para reutilizar los mismos cortes
// también en "Zonas / Vehículos" -> "Criterio de asignación ruta/cliente por
// distancia real" -- sin cambios de comportamiento aquí.
import { DISTANCE_TIERS, classifyDistanceKm } from "@/lib/distance-tiers";

export const dashboardRouter = Router();

// "Histórico y analítica" (último paso del flujo de las instrucciones
// ampliadas: pedido -> ... -> confirmación digital -> histórico y
// analítica). Existe un módulo de KPIs mucho más ambicioso ya escrito en
// `_deferred_v1.1_delta/modules/kpi/` (150+ combinaciones dimensión×métrica),
// pero depende de una vista materializada de Postgres pensada para un schema
// anterior -- adaptarla a ciegas (sin acceso a la base de datos real desde
// aquí para probarla) es un riesgo innecesario. Esta v1 cubre lo mismo que
// pide el flujo (coste real vs. estimado, OTIF, incidencias, ocupación,
// distancia, por periodo y por transportista) con Prisma normal -- sin SQL a
// medida ni migraciones, así que es tan seguro de desplegar como el resto de
// endpoints de esta sesión.

type Granularity = "day" | "week" | "month";

function bucketKey(date: Date, granularity: Granularity): string {
  if (granularity === "day") return date.toISOString().slice(0, 10);
  if (granularity === "month") return `${date.toISOString().slice(0, 7)}-01`;
  // Semana ISO (lunes como inicio), en UTC para no depender de la zona
  // horaria del proceso.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dayOfWeek);
  return d.toISOString().slice(0, 10);
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

// Fase 8Y: a diferencia de `pct` (usada por OTIF, donde "sin paradas" = 0%
// tiene sentido), OTD/OTS pueden tener denominador 0 en un periodo con
// actividad real (ninguna parada con ETA, o ningún envío salido todavía) --
// ahí un 0% sería engañoso ("cumplimiento nulo" en vez de "sin datos para
// medirlo"). Mismo criterio que warehouseDwellAvgHours/transitAvgHours.
function pctOrNull(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

dashboardRouter.get(
  "/history",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      from: z.coerce.date(),
      to: z.coerce.date(),
      warehouseId: z.string().uuid().optional(),
      carrierId: z.string().uuid().optional(),
      groupBy: z.enum(["day", "week", "month"]).optional(),
    });
    const query = schema.parse(req.query);
    if (query.from > query.to) throw HttpError.badRequest("La fecha de inicio no puede ser posterior a la de fin");

    const spanDays = (query.to.getTime() - query.from.getTime()) / (1000 * 60 * 60 * 24);
    const granularity: Granularity = query.groupBy ?? (spanDays <= 31 ? "day" : spanDays <= 180 ? "week" : "month");

    const routes = await prisma.route.findMany({
      where: {
        companyId: req.auth!.companyId,
        routeDate: { gte: query.from, lte: query.to },
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.carrierId ? { carrierId: query.carrierId } : {}),
      },
      include: {
        loadPlan: { select: { weightOccupancyPct: true, palletOccupancyPct: true, distanceKm: true } },
        // Ampliado para los dos gráficos nuevos de Analítica ("Top zonas por
        // volumen" y "Segmentación ABC de clientes"): hace falta el peso y el
        // destino/cliente de cada parada, no solo su estado. Aditivo -- el
        // resto de bloques que ya usaban `stops` (OTIF, nº de paradas) siguen
        // leyendo `status` exactamente igual.
        //
        // Fase 8V (2026-09-14): `order.createdAt` y `pod.deliveredAt` se
        // añaden para los dos KPI de tiempos que pidió Raúl ("fecha entrada
        // pedido vs fecha salida", "fecha salida pedido vs fecha entrega a
        // cliente") -- ver el cálculo de `warehouseDwellAvgHours`/
        // `transitAvgHours` más abajo.
        stops: {
          select: {
            status: true,
            // Fase 8Y: `eta` -- ETA planificada de la parada (calculada por el
            // motor de rutas al secuenciar) -- hace falta para el nuevo KPI
            // OTD (ver más abajo).
            eta: true,
            order: {
              select: {
                customerId: true,
                createdAt: true,
                customer: { select: { legalName: true } },
                deliveryPoint: { select: { province: true, city: true } },
                lines: { select: { lineWeightKg: true } },
              },
            },
            pod: { select: { deliveredAt: true } },
          },
        },
        costSimulations: { where: { isSelected: true }, select: { estimatedCost: true } },
        carrier: { select: { id: true, legalName: true } },
        shipment: {
          select: {
            id: true,
            departedAt: true,
            finishedAt: true,
            settlementLines: { select: { amount: true, marginAmount: true } },
            incidents: { select: { id: true } },
          },
        },
      },
      orderBy: { routeDate: "asc" },
    });

    interface Bucket {
      period: string;
      routes: number;
      stopsTotal: number;
      stopsCompleted: number;
      incidents: number;
      costReal: number;
      costEstimated: number;
      // Fase 14: beneficio real de BigMat (Descarga × paradas + Ingreso
      // €/TN Socios × toneladas de la tarifa por circuito+vehículo, ver
      // rate-resolution.service.ts) -- distinto de costReal, que es lo
      // pagado al transportista. Solo cuenta líneas con beneficio
      // calculable, ver marginUnknownLines.
      marginReal: number;
      marginUnknownLines: number;
      weightOccupancySum: number;
      palletOccupancySum: number;
      distanceKm: number;
      // Fase 8Y: petición de Raúl -- "la analitica debe tener claramente
      // visible de forma principal otd ots y otif". OTIF ya existía
      // (stopsCompleted/stopsTotal). Se añaden aquí los otros dos:
      //
      // OTD (entrega a tiempo): de las paradas COMPLETADAS que tenían una ETA
      // planificada (RouteStop.eta, calculada por el motor de rutas al
      // secuenciar) y ya tienen albarán firmado (pod.deliveredAt), cuántas se
      // entregaron dentro de la ETA + un margen de 15 min. Mide si la
      // ejecución se ajustó al plan operativo del día. Las paradas sin ETA
      // planificada (rutas antiguas sin recalcular, o sin geocodificar) no
      // cuentan ni a favor ni en contra -- no hay con qué comparar.
      //
      // OTS (salida a tiempo): de los ENVÍOS que ya salieron a reparto
      // (Shipment.departedAt), cuántos lo hicieron el mismo día natural que
      // su ruta tenía planificado (Route.routeDate). Aproximación honesta:
      // el schema no guarda una HORA de salida planificada (solo la fecha),
      // así que no se puede exigir puntualidad a la hora -- se mide "no se
      // retrasó a otro día", que es el dato real disponible. Documentado
      // igual que warehouseDwellAvgHours/transitAvgHours más abajo.
      otdEligible: number;
      otdOnTime: number;
      otsEligible: number;
      otsOnTime: number;
    }
    const emptyBucket = (period: string): Bucket => ({
      period,
      routes: 0,
      stopsTotal: 0,
      stopsCompleted: 0,
      incidents: 0,
      costReal: 0,
      costEstimated: 0,
      marginReal: 0,
      marginUnknownLines: 0,
      weightOccupancySum: 0,
      palletOccupancySum: 0,
      distanceKm: 0,
      otdEligible: 0,
      otdOnTime: 0,
      otsEligible: 0,
      otsOnTime: 0,
    });
    const OTD_TOLERANCE_MS = 15 * 60 * 1000;

    const buckets = new Map<string, Bucket>();
    const byCarrier = new Map<string, { carrierId: string; legalName: string; routes: number; incidents: number; costReal: number; marginReal: number; marginUnknownLines: number }>();
    // "Top zonas por volumen": peso movido por provincia (o población si no
    // hay provincia) del punto de entrega de cada parada -- aproximación real
    // a la idea de "ranking de rutas/zonas" del panel BI de referencia que
    // aportó Raúl, con datos que sí existen en el schema (no hay un código de
    // ruta/zona propio como "NOR1"/"MAD 02" en este TMS).
    const zoneWeight = new Map<string, number>();
    // Segmentación ABC de clientes por peso acumulado (Pareto): mismo criterio
    // que ya usa Product.abcClass para rotación de producto, aplicado aquí a
    // clientes por el peso movido en el periodo seleccionado.
    const customerWeight = new Map<string, { legalName: string; weightKg: number }>();
    // Fase 8V: "cumplimiento de entrega por cliente" -- mismo cálculo de OTIF
    // (paradas completadas / paradas totales) que ya se hace en agregado y por
    // transportista, ahora por cliente.
    const customerOtif = new Map<string, { legalName: string; stopsTotal: number; stopsCompleted: number }>();
    // Fase 8V: "fecha entrada pedido vs fecha salida" -- no existe en el
    // schema un evento real de "mercancía recibida en almacén" (solo el alta
    // del pedido en el sistema), así que se usa `Order.createdAt` como
    // aproximación honesta hasta la salida real del envío
    // (`Shipment.departedAt`) -- documentado también en el frontend, no es un
    // tiempo de almacén exacto.
    const dwellHoursSamples: number[] = [];
    // "fecha salida pedido vs fecha entrega a cliente" -- este sí es exacto:
    // salida real del envío hasta la firma del justificante de entrega de esa
    // parada concreta (`ProofOfDelivery.deliveredAt`). Solo cuenta paradas con
    // POD ya firmado -- las que no lo tienen (todavía en curso, o entrega
    // fallida sin firma) no aportan una muestra, en vez de inventar una.
    const transitHoursSamples: number[] = [];

    for (const r of routes) {
      const key = bucketKey(r.routeDate, granularity);
      const b = buckets.get(key) ?? emptyBucket(key);
      const costReal = r.shipment?.settlementLines.reduce((acc: number, l: any) => acc + Number(l.amount), 0) ?? 0;
      const costEstimated = r.costSimulations.reduce((acc: number, c: any) => acc + Number(c.estimatedCost), 0);
      const marginReal = r.shipment?.settlementLines.reduce((acc: number, l: any) => acc + (l.marginAmount != null ? Number(l.marginAmount) : 0), 0) ?? 0;
      const marginUnknownLines = r.shipment?.settlementLines.filter((l: any) => l.marginAmount == null).length ?? 0;
      const incidents = r.shipment?.incidents.length ?? 0;

      b.routes += 1;
      b.stopsTotal += r.stops.length;
      b.stopsCompleted += r.stops.filter((s) => s.status === "completed").length;
      b.incidents += incidents;
      b.costReal += costReal;
      b.costEstimated += costEstimated;
      b.marginReal += marginReal;
      b.marginUnknownLines += marginUnknownLines;
      b.weightOccupancySum += r.loadPlan ? Number(r.loadPlan.weightOccupancyPct) : 0;
      b.palletOccupancySum += r.loadPlan ? Number(r.loadPlan.palletOccupancyPct) : 0;
      b.distanceKm += r.loadPlan?.distanceKm ? Number(r.loadPlan.distanceKm) : 0;

      // OTS: una muestra por ENVÍO (no por parada), ver comentario en Bucket.
      if (r.shipment?.departedAt) {
        b.otsEligible += 1;
        const departedDay = r.shipment.departedAt.toISOString().slice(0, 10);
        const plannedDay = r.routeDate.toISOString().slice(0, 10);
        if (departedDay <= plannedDay) b.otsOnTime += 1;
      }

      buckets.set(key, b);

      if (r.carrier) {
        const c = byCarrier.get(r.carrier.id) ?? { carrierId: r.carrier.id, legalName: r.carrier.legalName, routes: 0, incidents: 0, costReal: 0, marginReal: 0, marginUnknownLines: 0 };
        c.routes += 1;
        c.incidents += incidents;
        c.costReal += costReal;
        c.marginReal += marginReal;
        c.marginUnknownLines += marginUnknownLines;
        byCarrier.set(r.carrier.id, c);
      }

      for (const stop of r.stops) {
        const order = stop.order;
        const stopWeight = order.lines.reduce((acc, l) => acc + Number(l.lineWeightKg ?? 0), 0);
        const zone = order.deliveryPoint.province || order.deliveryPoint.city || "Sin zona";
        zoneWeight.set(zone, (zoneWeight.get(zone) ?? 0) + stopWeight);

        const cw = customerWeight.get(order.customerId) ?? { legalName: order.customer.legalName, weightKg: 0 };
        cw.weightKg += stopWeight;
        customerWeight.set(order.customerId, cw);

        const co = customerOtif.get(order.customerId) ?? { legalName: order.customer.legalName, stopsTotal: 0, stopsCompleted: 0 };
        co.stopsTotal += 1;
        if (stop.status === "completed") co.stopsCompleted += 1;
        customerOtif.set(order.customerId, co);

        // OTD: solo paradas completadas con ETA planificada y albarán
        // firmado -- ver comentario en Bucket más arriba.
        if (stop.status === "completed" && stop.eta && stop.pod?.deliveredAt) {
          b.otdEligible += 1;
          if (stop.pod.deliveredAt.getTime() <= stop.eta.getTime() + OTD_TOLERANCE_MS) b.otdOnTime += 1;
        }

        if (r.shipment?.departedAt) {
          const dwellHours = (r.shipment.departedAt.getTime() - order.createdAt.getTime()) / (1000 * 60 * 60);
          if (dwellHours >= 0) dwellHoursSamples.push(dwellHours);

          if (stop.pod?.deliveredAt) {
            const transitHours = (stop.pod.deliveredAt.getTime() - r.shipment.departedAt.getTime()) / (1000 * 60 * 60);
            if (transitHours >= 0) transitHoursSamples.push(transitHours);
          }
        }
      }
    }

    const topZones = [...zoneWeight.entries()]
      .map(([zone, weightKg]) => ({ zone, weightKg: Math.round(weightKg) }))
      .sort((a, b) => b.weightKg - a.weightKg)
      .slice(0, 10);

    // Fase 28: "Segmentación de pedidos" (categoría de la ruta, ya calculada
    // por segmentation.service.ts) y "Modelo de transporte" (a portes/
    // dedicado, ver Route.transportModel) -- los dos conceptos nuevos de esta
    // fase, contados sobre las mismas `routes` del periodo/filtro ya cargadas
    // arriba, sin ninguna consulta adicional. Orden fijo (nunca alfabético)
    // para que el gráfico de Analítica no reordene las categorías al
    // cambiar de periodo -- mismo criterio que el resto de esta pantalla.
    //
    // `(r as any).transportModel` -- campo nuevo del esquema, ver el mismo
    // criterio de `as any` en routes.routes.ts (cliente de Prisma sin
    // regenerar en este sandbox no es excusa para bloquear el resto del
    // recálculo).
    const SERVICE_TYPE_ORDER: { value: string; label: string }[] = [
      { value: "paqueteria", label: "Paquetería" },
      { value: "paleteria", label: "Paletería" },
      { value: "paleteria_pesada", label: "Ligero" },
      { value: "gran_volumen", label: "Pesado" },
    ];
    const serviceTypeCounts = new Map<string, number>();
    const TRANSPORT_MODEL_ORDER: { value: string; label: string }[] = [
      { value: "dedicado", label: "Dedicado" },
      { value: "a_portes", label: "A portes" },
      { value: "sin_clasificar", label: "Sin clasificar" },
    ];
    const transportModelCounts = new Map<string, number>();
    for (const r of routes) {
      serviceTypeCounts.set(r.serviceType, (serviceTypeCounts.get(r.serviceType) ?? 0) + 1);
      const transportModel = (r as any).transportModel ?? "sin_clasificar";
      transportModelCounts.set(transportModel, (transportModelCounts.get(transportModel) ?? 0) + 1);
    }
    const serviceTypeBreakdown = SERVICE_TYPE_ORDER.map(({ value, label }) => ({
      segment: value,
      label,
      routes: serviceTypeCounts.get(value) ?? 0,
    }));
    const transportModelBreakdown = TRANSPORT_MODEL_ORDER.map(({ value, label }) => ({
      model: value,
      label,
      routes: transportModelCounts.get(value) ?? 0,
    }));

    // Clasificación ABC: A = clientes cuyo peso acumulado (de mayor a menor)
    // llega hasta el 70% del total movido en el periodo; B hasta el 90%; C
    // hasta el 98%; D el resto -- mismos cortes que muestra el panel de
    // referencia de Raúl. El tamaño de cada "tarta" de la dona es el número de
    // clientes en cada clase (revela la concentración real: pocos clientes
    // grandes cargan la mayoría del peso), no el peso -- que por construcción
    // rondaría siempre 70/20/8/2.
    const sortedCustomers = [...customerWeight.values()].sort((a, b) => b.weightKg - a.weightKg);
    const totalCustomerWeight = sortedCustomers.reduce((acc, c) => acc + c.weightKg, 0);
    const abcClasses: Array<{ cls: "A" | "B" | "C" | "D"; customerCount: number; weightKg: number }> = [
      { cls: "A", customerCount: 0, weightKg: 0 },
      { cls: "B", customerCount: 0, weightKg: 0 },
      { cls: "C", customerCount: 0, weightKg: 0 },
      { cls: "D", customerCount: 0, weightKg: 0 },
    ];
    let cumulativeWeight = 0;
    for (const c of sortedCustomers) {
      cumulativeWeight += c.weightKg;
      const cumulativePct = totalCustomerWeight > 0 ? (cumulativeWeight / totalCustomerWeight) * 100 : 100;
      const bucket =
        cumulativePct <= 70 ? abcClasses[0] : cumulativePct <= 90 ? abcClasses[1] : cumulativePct <= 98 ? abcClasses[2] : abcClasses[3];
      bucket.customerCount += 1;
      bucket.weightKg += c.weightKg;
    }
    const customerAbc = abcClasses.map((c) => ({ ...c, weightKg: Math.round(c.weightKg) }));

    // Fase 8V: media de horas de las dos listas de muestras -- null (no 0) si
    // no hay ninguna muestra en el periodo/filtro elegido, para no dar a
    // entender "0 horas" cuando en realidad no hay dato.
    const avgHours = (samples: number[]) =>
      samples.length > 0 ? Math.round((samples.reduce((acc, h) => acc + h, 0) / samples.length) * 10) / 10 : null;
    const warehouseDwellAvgHours = avgHours(dwellHoursSamples);
    const transitAvgHours = avgHours(transitHoursSamples);

    // "Cumplimiento de entrega por cliente": los de peor cumplimiento
    // primero (son los que de verdad hace falta revisar), tope de 15 -- mismo
    // criterio de recorte que "Top zonas por volumen".
    const customerCompliance = [...customerOtif.entries()]
      .map(([customerId, c]) => ({
        customerId,
        legalName: c.legalName,
        stopsTotal: c.stopsTotal,
        stopsCompleted: c.stopsCompleted,
        otifPct: pct(c.stopsCompleted, c.stopsTotal),
      }))
      .sort((a, b) => a.otifPct - b.otifPct)
      .slice(0, 15);

    const sortedBuckets = [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period));

    const totals = sortedBuckets.reduce(
      (acc, b) => ({
        routes: acc.routes + b.routes,
        stopsTotal: acc.stopsTotal + b.stopsTotal,
        stopsCompleted: acc.stopsCompleted + b.stopsCompleted,
        incidents: acc.incidents + b.incidents,
        costReal: acc.costReal + b.costReal,
        costEstimated: acc.costEstimated + b.costEstimated,
        marginReal: acc.marginReal + b.marginReal,
        marginUnknownLines: acc.marginUnknownLines + b.marginUnknownLines,
        distanceKm: acc.distanceKm + b.distanceKm,
        otdEligible: acc.otdEligible + b.otdEligible,
        otdOnTime: acc.otdOnTime + b.otdOnTime,
        otsEligible: acc.otsEligible + b.otsEligible,
        otsOnTime: acc.otsOnTime + b.otsOnTime,
      }),
      { routes: 0, stopsTotal: 0, stopsCompleted: 0, incidents: 0, costReal: 0, costEstimated: 0, marginReal: 0, marginUnknownLines: 0, distanceKm: 0, otdEligible: 0, otdOnTime: 0, otsEligible: 0, otsOnTime: 0 }
    );

    res.json({
      range: { from: query.from, to: query.to, groupBy: granularity },
      totals: {
        routes: totals.routes,
        otifPct: pct(totals.stopsCompleted, totals.stopsTotal),
        // Fase 8Y: OTD/OTS -- ver comentario junto a Bucket. `null` cuando no
        // hay ninguna muestra elegible en el periodo/filtro (no "0%").
        otdPct: pctOrNull(totals.otdOnTime, totals.otdEligible),
        otdEligible: totals.otdEligible,
        otsPct: pctOrNull(totals.otsOnTime, totals.otsEligible),
        otsEligible: totals.otsEligible,
        incidents: totals.incidents,
        incidentRatePct: pct(totals.incidents, totals.routes),
        costReal: totals.costReal,
        costEstimated: totals.costEstimated,
        costDeviationPct: totals.costEstimated > 0 ? Math.round(((totals.costReal - totals.costEstimated) / totals.costEstimated) * 1000) / 10 : null,
        // Fase 14: beneficio real de BigMat en el periodo -- petición de
        // Raúl de dar "el parámetro de coste beneficio por ruta" también en
        // Analítica, no solo en Facturación. `marginUnknownLines` avisa
        // cuántas liquidaciones del periodo no tienen beneficio calculable
        // (generadas antes de esta fase, o con tarifa sin cobro a cliente).
        marginReal: Math.round(totals.marginReal * 100) / 100,
        marginUnknownLines: totals.marginUnknownLines,
        distanceKm: Math.round(totals.distanceKm),
        // Fase 8V: "total pedidos por ruta" -- media de pedidos (paradas) por
        // ruta en el periodo, no el total absoluto (ya lo da `stopsTotal` de
        // forma indirecta vía `routes`×esta media, pero como cifra suelta el
        // total absoluto no dice nada sin el nº de rutas).
        avgStopsPerRoute: totals.routes > 0 ? Math.round((totals.stopsTotal / totals.routes) * 10) / 10 : 0,
        warehouseDwellAvgHours,
        transitAvgHours,
      },
      buckets: sortedBuckets.map((b) => ({
        period: b.period,
        routes: b.routes,
        otifPct: pct(b.stopsCompleted, b.stopsTotal),
        otdPct: pctOrNull(b.otdOnTime, b.otdEligible),
        otsPct: pctOrNull(b.otsOnTime, b.otsEligible),
        incidents: b.incidents,
        costReal: Math.round(b.costReal * 100) / 100,
        costEstimated: Math.round(b.costEstimated * 100) / 100,
        // Fase 14: beneficio real de BigMat en el bucket -- mismo criterio
        // que en `totals` (ver comentario más abajo), aquí por periodo para
        // poder pintarlo junto a costReal/costEstimated en la serie temporal.
        marginReal: Math.round(b.marginReal * 100) / 100,
        marginUnknownLines: b.marginUnknownLines,
        weightOccupancyPct: b.routes > 0 ? Math.round((b.weightOccupancySum / b.routes) * 1000) / 10 : 0,
        palletOccupancyPct: b.routes > 0 ? Math.round((b.palletOccupancySum / b.routes) * 1000) / 10 : 0,
        distanceKm: Math.round(b.distanceKm),
      })),
      byCarrier: [...byCarrier.values()]
        .sort((a, b) => b.routes - a.routes)
        .map((c) => ({ ...c, costReal: Math.round(c.costReal * 100) / 100, marginReal: Math.round(c.marginReal * 100) / 100 })),
      topZones,
      customerAbc,
      serviceTypeBreakdown,
      transportModelBreakdown,
      customerCompliance,
    });
  })
);

dashboardRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const [
      pendingOrders,
      inTransitShipments,
      deliveredToday,
      totalToday,
      openIncidents,
      routesInPreparation,
    ] = await Promise.all([
      prisma.order.count({ where: { companyId, status: { in: ["received", "validated"] } } }),
      prisma.shipment.count({ where: { route: { companyId }, status: "in_transit" } }),
      prisma.routeStop.count({ where: { route: { companyId }, status: "completed" } }),
      prisma.routeStop.count({ where: { route: { companyId } } }),
      prisma.incident.count({ where: { shipment: { route: { companyId } }, status: "open" } }),
      prisma.route.count({ where: { companyId, status: { in: ["draft", "optimized"] } } }),
    ]);

    const todaysSettlementLines = await prisma.settlementLine.findMany({
      where: {
        shipment: { route: { companyId }, finishedAt: { gte: startOfDay, lte: endOfDay } },
      },
    });
    const costToday = todaysSettlementLines.reduce((acc, l) => acc + Number(l.amount), 0);

    const otifPct = totalToday > 0 ? Math.round((deliveredToday / totalToday) * 100) : 100;

    res.json({
      pendingOrders,
      routesInPreparation,
      inTransitShipments,
      deliveredToday,
      totalStopsToday: totalToday,
      otifPct,
      openIncidents,
      costToday,
    });
  })
);

dashboardRouter.get(
  "/incidents",
  asyncHandler(async (req, res) => {
    const items = await prisma.incident.findMany({
      where: { shipment: { route: { companyId: req.auth!.companyId } }, status: "open" },
      include: { shipment: { include: { carrier: { select: { legalName: true } } } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    res.json({ items, total: items.length });
  })
);

dashboardRouter.get(
  "/carrier-ranking",
  asyncHandler(async (req, res) => {
    const carriers = await prisma.carrier.findMany({
      where: { companyId: req.auth!.companyId, active: true },
      include: {
        shipments: { include: { route: { include: { stops: true } } } },
        _count: { select: { shipments: true } },
      },
    });

    const ranking = await Promise.all(
      carriers.map(async (c) => {
        const incidents = await prisma.incident.count({ where: { shipment: { carrierId: c.id } } });
        const finished = c.shipments.filter((s) => s.status === "finished");
        return {
          carrierId: c.id,
          legalName: c.legalName,
          totalShipments: c._count.shipments,
          finishedShipments: finished.length,
          incidents,
        };
      })
    );

    ranking.sort((a, b) => a.incidents - b.incidents);
    res.json({ items: ranking });
  })
);

// Fase 8S: rediseño de "Inicio" como panel general de operaciones (petición
// de Raúl: "según accedes a la aplicación, un resumen global del estado
// actualizado del sistema... datos, visibilidad, gráficos"). Un único
// endpoint en vez de reutilizar /summary + /history + /incidents +
// /carrier-ranking sueltos, porque el panel nuevo necesita combinaciones que
// ninguno de esos calcula ya (envíos retrasados, desglose de estado de
// entrega de hoy, ocupación real de flota/conductores, alertas de ITV/seguro)
// -- y así la pantalla de Inicio hace una sola llamada, no cuatro.
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

dashboardRouter.get(
  "/home",
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const now = new Date();
    const startToday = startOfToday();
    const endToday = endOfToday();
    const sevenDaysAgo = new Date(startToday);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const expiryThreshold = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [
      pendingOrders,
      activeShipmentsRaw,
      stopsToday,
      todaysSettlementLines,
      vehiclesTotal,
      vehiclesInUse,
      driversTotal,
      driversOnShiftRaw,
      shipments7d,
      settlementLines7d,
      openIncidents,
      expiringVehicles,
      recentShipmentsRaw,
    ] = await Promise.all([
      prisma.order.count({ where: { companyId, status: { in: ["received", "validated"] } } }),
      // Envíos activos (cargados o circulando) + sus paradas pendientes/
      // llegadas todavía sin completar, para poder saber cuántos de esos
      // envíos llevan ya alguna parada con la ETA superada ("retrasados").
      prisma.shipment.findMany({
        where: { route: { companyId }, status: { in: ["loaded", "in_transit"] } },
        select: {
          id: true,
          route: { select: { stops: { where: { status: { in: ["pending", "arrived"] } }, select: { eta: true } } } },
        },
      }),
      // Paradas de las rutas de HOY, con su incidencia abierta si la tiene --
      // base del desglose "Estados de Entrega" (en tránsito/entregado/
      // retrasado/con incidencia).
      prisma.routeStop.findMany({
        where: { route: { companyId, routeDate: { gte: startToday, lte: endToday } } },
        select: { status: true, eta: true, incidents: { where: { status: "open" }, select: { id: true } } },
      }),
      prisma.settlementLine.findMany({
        where: { shipment: { route: { companyId }, finishedAt: { gte: startToday, lte: endToday } } },
        select: { amount: true },
      }),
      prisma.vehicle.count({ where: { deletedAt: null, active: true, carrier: { companyId } } }),
      // "En uso" = vinculado ahora mismo a un envío cargado o circulando.
      prisma.vehicle.count({
        where: { deletedAt: null, active: true, carrier: { companyId }, shipments: { some: { status: { in: ["loaded", "in_transit"] } } } },
      }),
      prisma.driver.count({ where: { active: true, carrier: { companyId } } }),
      // Jornada abierta (endedAt nulo) = conductor de servicio ahora mismo.
      prisma.driverShift.findMany({
        where: { endedAt: null, driver: { carrier: { companyId } } },
        select: { driverId: true },
      }),
      prisma.shipment.findMany({
        where: { route: { companyId, routeDate: { gte: sevenDaysAgo } } },
        select: { route: { select: { routeDate: true } } },
      }),
      prisma.settlementLine.findMany({
        where: { shipment: { route: { companyId, routeDate: { gte: sevenDaysAgo } } } },
        select: { amount: true, shipment: { select: { carrierId: true, carrier: { select: { legalName: true } } } } },
      }),
      prisma.incident.findMany({
        where: { shipment: { route: { companyId } }, status: "open" },
        include: {
          shipment: { select: { carrier: { select: { legalName: true } }, vehicle: { select: { plate: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      // Fase 8Q: ITV/seguro a punto de caducar (<=30 días) o ya caducado --
      // mismo criterio de "alerta crítica de mantenimiento" del panel de
      // referencia de Raúl ("Mantenimiento Urgente Camión").
      prisma.vehicle.findMany({
        where: {
          deletedAt: null,
          active: true,
          carrier: { companyId },
          OR: [
            { itvExpiry: { lte: expiryThreshold } },
            { insuranceExpiry: { lte: expiryThreshold } },
          ],
        },
        select: { id: true, plate: true, itvExpiry: true, insuranceExpiry: true },
        take: 5,
      }),
      prisma.shipment.findMany({
        where: { route: { companyId } },
        include: {
          route: {
            select: {
              routeDate: true,
              warehouse: { select: { name: true } },
              stops: {
                orderBy: { sequence: "asc" },
                select: {
                  status: true,
                  eta: true,
                  order: { select: { deliveryPoint: { select: { city: true } } } },
                },
              },
            },
          },
          carrier: { select: { legalName: true } },
          vehicle: { select: { plate: true } },
        },
        orderBy: { route: { routeDate: "desc" } },
        take: 8,
      }),
    ]);

    // ---- KPIs ----
    const activeShipments = activeShipmentsRaw.length;
    const delayedShipments = activeShipmentsRaw.filter((s) => s.route.stops.some((st) => st.eta && st.eta < now)).length;
    const costToday = todaysSettlementLines.reduce((acc, l) => acc + Number(l.amount), 0);

    let entregado = 0;
    let enTransito = 0;
    let retrasado = 0;
    let problemas = 0;
    for (const stop of stopsToday) {
      if (stop.incidents.length > 0) {
        problemas += 1;
      } else if (stop.status === "completed") {
        entregado += 1;
      } else if (stop.status === "failed") {
        problemas += 1;
      } else if (stop.eta && stop.eta < now) {
        retrasado += 1;
      } else {
        enTransito += 1;
      }
    }
    const fleetEfficiencyPct = stopsToday.length > 0 ? Math.round((entregado / stopsToday.length) * 1000) / 10 : 100;

    // ---- Volumen semanal (últimos 7 días, incluido hoy) ----
    const dayBuckets = new Map<string, number>();
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      dayBuckets.set(isoDay(d), 0);
    }
    for (const s of shipments7d) {
      const key = isoDay(s.route.routeDate);
      if (dayBuckets.has(key)) dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + 1);
    }
    const weeklyVolume = [...dayBuckets.entries()].map(([date, shipments]) => ({ date, shipments }));

    // ---- Coste por transportista (últimos 7 días) ----
    const costByCarrierMap = new Map<string, { carrierId: string; legalName: string; costReal: number }>();
    for (const line of settlementLines7d) {
      const carrierId = line.shipment.carrierId;
      const entry = costByCarrierMap.get(carrierId) ?? { carrierId, legalName: line.shipment.carrier.legalName, costReal: 0 };
      entry.costReal += Number(line.amount);
      costByCarrierMap.set(carrierId, entry);
    }
    const costByCarrier = [...costByCarrierMap.values()]
      .map((c) => ({ ...c, costReal: Math.round(c.costReal * 100) / 100 }))
      .sort((a, b) => b.costReal - a.costReal)
      .slice(0, 6);

    // ---- Alertas críticas: incidencias abiertas + vehículos con ITV/seguro
    // a punto de caducar, mezcladas y recortadas a las 6 más relevantes. ----
    const incidentTypeLabel: Record<string, string> = {
      delay: "Retraso en envío",
      damage: "Mercancía dañada",
      refused: "Entrega rechazada",
      access_issue: "Problema de acceso",
      other: "Incidencia",
    };
    const incidentAlerts = openIncidents.map((inc) => ({
      id: `incident-${inc.id}`,
      severity: "urgent" as const,
      title: incidentTypeLabel[inc.incidentType] ?? "Incidencia",
      subtitle: `${inc.shipment.carrier?.legalName ?? "Transportista"} · ${inc.shipment.vehicle?.plate ?? "sin vehículo"}`,
      at: inc.createdAt,
    }));
    // Un vehículo puede aparecer en `expiringVehicles` porque su ITV está
    // próxima, porque lo está su seguro, o ambas a la vez -- se genera una
    // alerta por cada documento que de verdad esté dentro del umbral (antes
    // se etiquetaba siempre como "ITV" con solo mirar si itvExpiry no era
    // nulo, aunque lo que estuviera realmente a punto de caducar fuera el
    // seguro).
    const vehicleAlerts = expiringVehicles.flatMap((v) => {
      const alerts: { id: string; severity: "warning"; title: string; subtitle: string; at: Date }[] = [];
      if (v.itvExpiry != null && v.itvExpiry <= expiryThreshold) {
        alerts.push({
          id: `vehicle-itv-${v.id}`,
          severity: "warning",
          title: `ITV ${v.itvExpiry < now ? "caducada" : "a punto de caducar"} · ${v.plate}`,
          subtitle: new Date(v.itvExpiry).toLocaleDateString("es-ES"),
          at: v.itvExpiry,
        });
      }
      if (v.insuranceExpiry != null && v.insuranceExpiry <= expiryThreshold) {
        alerts.push({
          id: `vehicle-insurance-${v.id}`,
          severity: "warning",
          title: `Seguro ${v.insuranceExpiry < now ? "caducado" : "a punto de caducar"} · ${v.plate}`,
          subtitle: new Date(v.insuranceExpiry).toLocaleDateString("es-ES"),
          at: v.insuranceExpiry,
        });
      }
      return alerts;
    });
    const criticalAlerts = [...incidentAlerts, ...vehicleAlerts]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 6)
      .map(({ id, severity, title, subtitle }) => ({ id, severity, title, subtitle }));

    // ---- Envíos recientes ----
    const recentShipments = recentShipmentsRaw.map((s) => {
      const stops = s.route.stops;
      const lastCity = [...stops].reverse().find((st) => st.order.deliveryPoint.city)?.order.deliveryPoint.city;
      const pendingStop = stops.find((st) => st.status === "pending" || st.status === "arrived");
      return {
        id: s.id,
        status: s.status,
        route: `${s.route.warehouse.name} → ${lastCity ?? (stops.length > 1 ? `${stops.length} paradas` : "destino único")}`,
        carrierName: s.carrier.legalName,
        vehiclePlate: s.vehicle.plate,
        routeDate: s.route.routeDate,
        eta: pendingStop?.eta ?? stops[stops.length - 1]?.eta ?? null,
      };
    });

    res.json({
      kpis: {
        activeShipments,
        delayedShipments,
        pendingOrders,
        costToday: Math.round(costToday * 100) / 100,
        fleetEfficiencyPct,
      },
      weeklyVolume,
      deliveryStatus: [
        { key: "en_transito", label: "En tránsito", count: enTransito },
        { key: "entregado", label: "Entregado", count: entregado },
        { key: "retrasado", label: "Retrasado", count: retrasado },
        { key: "problemas", label: "Con incidencia", count: problemas },
      ],
      recentShipments,
      fleetUtilization: {
        vehiclesTotal,
        vehiclesInUse,
        vehiclesAvailable: Math.max(0, vehiclesTotal - vehiclesInUse),
        driversTotal,
        driversOnShift: new Set(driversOnShiftRaw.map((d) => d.driverId)).size,
        driversAvailable: Math.max(0, driversTotal - new Set(driversOnShiftRaw.map((d) => d.driverId)).size),
      },
      costByCarrier,
      criticalAlerts,
    });
  })
);

// Fase 16: rediseño de "Inicio" -- petición explícita de Raúl con el listado
// concreto de indicadores que quiere ver en esa pantalla ("toneladas movidas
// total acumulado + kg por mes, pedidos registrados total acumulado +
// reparto acumulado por día, rutas operativas + top rutas por volumen,
// porcentajes actualizados de OTD/OTS/OTIF, coste acumulado vs ingresos
// acumulados"). A diferencia de /home (acotado a hoy/7 días) y de /history
// (acotado al rango de fechas que pida el llamante), este endpoint es
// deliberadamente SIN filtro de fecha -- "acumulado" se resolvió con Raúl
// como todo el histórico real, no una ventana móvil.
//
// "Ingresos acumulados": se resolvió con Raúl que, a falta de un importe de
// facturación al cliente independiente en el schema, "ingresos" se muestra
// aquí como el beneficio ya calculado en Fase 14 (marginReal / liquidaciones
// con `marginAmount`), frente al coste real acumulado -- no un total
// facturado nuevo.
//
// "Rutas operativas" / "top rutas por volumen": el schema no tiene un código
// de ruta propio como el "NOR1"/"MAD 02" del panel de referencia de Raúl --
// lo más parecido que existe es el circuito de reparto (DeliveryZone, ver
// comentario en el modelo). "Operativas" = circuitos activos de la empresa;
// el ranking por volumen sí necesita resolver, parada a parada, A QUÉ
// circuito pertenece cada cliente+almacén -- se reutiliza
// resolveDeliveryZonesForPairs (Fase 15) para responder exactamente lo mismo
// que ya usan Planificación y el comparador de transportistas.
//
// Mismo criterio que /history (ver comentario de cabecera del archivo): todo
// en memoria con Prisma normal, sin SQL a medida ni vista materializada --
// coherente con el resto de este módulo aunque no tenga filtro de fecha.
const WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

dashboardRouter.get(
  "/accumulated",
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const OTD_TOLERANCE_MS = 15 * 60 * 1000;

    const [stops, shipments, totalOrders, rutasOperativas] = await Promise.all([
      prisma.routeStop.findMany({
        where: { route: { companyId } },
        select: {
          status: true,
          eta: true,
          route: { select: { routeDate: true } },
          order: {
            select: {
              customerId: true,
              warehouseId: true,
              lines: { select: { lineWeightKg: true } },
            },
          },
          pod: { select: { deliveredAt: true } },
        },
      }),
      prisma.shipment.findMany({
        where: { route: { companyId } },
        select: {
          departedAt: true,
          route: { select: { routeDate: true } },
          settlementLines: { select: { amount: true, marginAmount: true } },
        },
      }),
      prisma.order.count({ where: { companyId } }),
      prisma.deliveryZone.count({ where: { companyId, active: true } }),
    ]);

    // Circuito efectivo de cada combinación cliente+almacén que aparece en
    // alguna parada -- una sola resolución en lote (no una consulta por
    // parada) para poder rankear "top rutas por volumen".
    const pairsMap = new Map<string, { customerId: string; warehouseId: string }>();
    for (const s of stops) {
      const key = `${s.order.customerId}::${s.order.warehouseId}`;
      if (!pairsMap.has(key)) pairsMap.set(key, { customerId: s.order.customerId, warehouseId: s.order.warehouseId });
    }
    const zoneByPair = await resolveDeliveryZonesForPairs([...pairsMap.values()]);

    let totalKg = 0;
    const monthKg = new Map<string, number>();
    const weekdayKg = new Map<number, number>();
    const zoneWeight = new Map<string, number>();
    let stopsTotal = 0;
    let stopsCompleted = 0;
    let otdEligible = 0;
    let otdOnTime = 0;

    for (const s of stops) {
      const weightKg = s.order.lines.reduce((acc, l) => acc + Number(l.lineWeightKg ?? 0), 0);
      totalKg += weightKg;

      const routeDate = s.route.routeDate;
      const monthKey = routeDate.toISOString().slice(0, 7);
      monthKg.set(monthKey, (monthKg.get(monthKey) ?? 0) + weightKg);
      const weekday = (routeDate.getUTCDay() + 6) % 7; // 0 = lunes
      weekdayKg.set(weekday, (weekdayKg.get(weekday) ?? 0) + weightKg);

      const zoneKey = `${s.order.customerId}::${s.order.warehouseId}`;
      const zoneName = zoneByPair.get(zoneKey)?.name ?? "Sin circuito asignado";
      zoneWeight.set(zoneName, (zoneWeight.get(zoneName) ?? 0) + weightKg);

      stopsTotal += 1;
      if (s.status === "completed") stopsCompleted += 1;
      // OTD: ver comentario detallado junto al mismo cálculo en /history.
      if (s.status === "completed" && s.eta && s.pod?.deliveredAt) {
        otdEligible += 1;
        if (s.pod.deliveredAt.getTime() <= s.eta.getTime() + OTD_TOLERANCE_MS) otdOnTime += 1;
      }
    }

    let otsEligible = 0;
    let otsOnTime = 0;
    let costeAcumulado = 0;
    let margenAcumulado = 0;
    let marginUnknownLines = 0;
    for (const sh of shipments) {
      // OTS: ver comentario detallado junto al mismo cálculo en /history.
      if (sh.departedAt) {
        otsEligible += 1;
        const departedDay = sh.departedAt.toISOString().slice(0, 10);
        const plannedDay = sh.route.routeDate.toISOString().slice(0, 10);
        if (departedDay <= plannedDay) otsOnTime += 1;
      }
      for (const l of sh.settlementLines) {
        costeAcumulado += Number(l.amount);
        if (l.marginAmount != null) margenAcumulado += Number(l.marginAmount);
        else marginUnknownLines += 1;
      }
    }

    const porMes = [...monthKg.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, kg]) => ({ month, kg: Math.round(kg) }));

    const porDiaSemana = WEEKDAY_LABELS.map((label, idx) => ({
      day: idx,
      label,
      weightKg: Math.round(weekdayKg.get(idx) ?? 0),
    }));

    const topPorVolumen = [...zoneWeight.entries()]
      .map(([name, weightKg]) => ({ name, weightKg: Math.round(weightKg) }))
      .sort((a, b) => b.weightKg - a.weightKg)
      .slice(0, 10);

    res.json({
      toneladas: {
        totalKg: Math.round(totalKg),
        totalTn: Math.round((totalKg / 1000) * 10) / 10,
        porMes,
      },
      pedidos: { total: totalOrders },
      reparto: { porDiaSemana },
      rutas: { operativas: rutasOperativas, topPorVolumen },
      kpi: {
        otdPct: pctOrNull(otdOnTime, otdEligible),
        otdEligible,
        otsPct: pctOrNull(otsOnTime, otsEligible),
        otsEligible,
        otifPct: pct(stopsCompleted, stopsTotal),
        stopsTotal,
        stopsCompleted,
      },
      finanzas: {
        costeAcumulado: Math.round(costeAcumulado * 100) / 100,
        margenAcumulado: Math.round(margenAcumulado * 100) / 100,
        marginUnknownLines,
      },
    });
  })
);

// Fase 16: umbrales de la "zona de influencia" por radio de distancia que
// pidió Raúl para el mapa interactivo de clientes de Inicio -- mismos cortes
// que su panel de referencia (0-40 / 40-120 / 120-250 / 250-450 / >450 km).
// Distinto de InfluenceZone (Objetivo 2, configurable por almacén y pensado
// para asignar vehículo): aquí es solo una clasificación visual fija para
// colorear el mapa y sugerir una "zona de reparto recomendada" en la ficha
// de cada cliente. (Fase 19: DISTANCE_TIERS/classifyDistanceKm ahora viven en
// @/lib/distance-tiers, importados arriba, para reutilizarse también en
// "Zonas / Vehículos" -- sin cambios de comportamiento aquí.)

// Frecuencia de envío sugerida: a falta de un campo de frecuencia pactada
// con el cliente, se estima a partir de su ritmo real de pedidos (nº de
// pedidos / meses transcurridos entre el primero y el último) -- un dato
// real del cliente, no solo una suposición por su distancia al almacén.
function suggestedFrequencyLabel(totalOrders: number, firstOrder: Date, lastOrder: Date): string {
  if (totalOrders < 2) return "Sin histórico suficiente";
  const spanDays = Math.max(1, (lastOrder.getTime() - firstOrder.getTime()) / (1000 * 60 * 60 * 24));
  const ordersPerMonth = totalOrders / Math.max(1, spanDays / 30);
  if (ordersPerMonth >= 20) return "Diaria";
  if (ordersPerMonth >= 8) return "2-3 veces por semana";
  if (ordersPerMonth >= 4) return "Semanal";
  if (ordersPerMonth >= 2) return "Quincenal";
  return "Mensual o menor";
}

dashboardRouter.get(
  "/clients-map",
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;

    // Fase 16 (depuración): pasos secuenciales y etiquetados en vez de un
    // único Promise.all -- si alguno falla, el `console.error` del servidor
    // dice EXACTAMENTE cuál (antes, el error genérico de errorHandler.ts no
    // decía qué consulta lo había provocado, solo "Error interno del
    // servidor" en el navegador). Quitar esta etiqueta cuando se confirme
    // que las 4 consultas funcionan de forma estable contra datos reales.
    async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
      try {
        return await fn();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[dashboard/clients-map] fallo en "${label}":`, err);
        // Se relanza como HttpError (en vez del error original) para que el
        // mensaje concreto llegue también al frontend -- ahora mismo
        // muestra "Error interno del servidor" sin más detalle, y sin poder
        // ver la consola del backend no hay forma de saber qué consulta ha
        // fallado. Temporal mientras se depura esta pantalla.
        throw new HttpError(500, `Fallo en "${label}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const warehouses = await step<any>("warehouses", () =>
      prisma.warehouse.findMany({
        where: { companyId, active: true },
        select: { id: true, name: true, lat: true, lng: true },
      })
    );
    const customers = await step<any>("customers", () =>
      prisma.customer.findMany({
        where: { companyId, active: true, deletedAt: null },
        select: {
          id: true,
          legalName: true,
          deliveryPoints: {
            where: { active: true, deletedAt: null, lat: { not: null }, lng: { not: null } },
            select: { lat: true, lng: true },
            // Mismo criterio de "punto de entrega principal" (el más
            // antiguo activo) que usa customer-default-address.service.ts al
            // editar la ficha del cliente -- determinista, en vez de confiar
            // en el orden por defecto de Prisma.
            orderBy: { createdAt: "asc" },
            take: 1,
          },
          // Circuito por defecto del cliente y almacén al que pertenece --
          // ver resolución de almacén de referencia más abajo.
          deliveryZone: { select: { warehouseId: true } },
        },
      })
    );
    const orderCustomerStats = await step<any>("orderCustomerStats", () =>
      prisma.order.groupBy({
        by: ["customerId"],
        where: { companyId },
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      })
    );

    const warehouseById = new Map<string, (typeof warehouses)[number]>(warehouses.map((w: any) => [w.id, w]));
    const geolocatedWarehouses = warehouses.filter((w: any) => w.lat != null && w.lng != null);
    const orderStatsByCustomer = new Map<string, (typeof orderCustomerStats)[number]>(
      orderCustomerStats.map((r: any) => [r.customerId, r])
    );

    // Fase 16 (corrección explícita de Raúl: "los puntos en el mapa no deben
    // depender de los envios realizados, si no de las direcciones de los
    // clientes... una vez todos posicionados, los datos que ofrezca el
    // resumen al clickar en el cliente si que daran datos de entregas si las
    // ha habido"). El almacén "de referencia" de cada cliente para situarlo
    // en el mapa YA NO se calcula por historial de pedidos -- se resuelve
    // solo a partir de su dirección y de su maestro de datos:
    //   1) el almacén del circuito de reparto por defecto del cliente
    //      (Customer.deliveryZoneId -> DeliveryZone.warehouseId), si existe
    //      y está geolocalizado -- es la asignación real del maestro de
    //      clientes, tenga o no pedidos todavía.
    //   2) si solo hay un almacén geolocalizado en la empresa, ese.
    //   3) en cualquier otro caso (varios almacenes y cliente sin circuito
    //      asignado), el almacén geolocalizado más cercano en línea recta a
    //      su dirección de entrega -- sigue siendo una posición determinada
    //      por su dirección, nunca por si ha habido envíos o no.
    function resolveAnchorWarehouseId(point: RoutePoint, zoneWarehouseId: string | null | undefined): string | null {
      if (zoneWarehouseId) {
        const zw = warehouseById.get(zoneWarehouseId);
        if (zw && zw.lat != null && zw.lng != null) return zw.id;
      }
      if (geolocatedWarehouses.length === 1) return geolocatedWarehouses[0].id;
      if (geolocatedWarehouses.length === 0) return null;
      let nearest: { id: string; km: number } | null = null;
      for (const w of geolocatedWarehouses) {
        const km = haversineKm(point, { lat: w.lat, lng: w.lng });
        if (!nearest || km < nearest.km) nearest = { id: w.id, km };
      }
      return nearest?.id ?? null;
    }

    let skippedNoCoordinates = 0;
    const anchorByCustomer = new Map<string, string>();
    const zonePairs: Array<{ customerId: string; warehouseId: string }> = [];

    for (const c of customers) {
      const point = c.deliveryPoints[0];
      if (!point) {
        skippedNoCoordinates += 1;
        continue;
      }
      const anchorId = resolveAnchorWarehouseId({ lat: point.lat!, lng: point.lng! }, c.deliveryZone?.warehouseId ?? null);
      if (!anchorId) {
        // Solo puede pasar si ningún almacén activo tiene coordenadas -- caso
        // ya cubierto en el frontend (aviso "Ningún almacén tiene
        // coordenadas configuradas todavía").
        skippedNoCoordinates += 1;
        continue;
      }
      anchorByCustomer.set(c.id, anchorId);
      zonePairs.push({ customerId: c.id, warehouseId: anchorId });
    }

    const zoneByPair = await step("resolveDeliveryZonesForPairs", () => resolveDeliveryZonesForPairs(zonePairs));

    const clients: Array<{
      id: string;
      legalName: string;
      lat: number;
      lng: number;
      warehouseId: string;
      warehouseName: string;
      distanceKm: number;
      zoneTier: string;
      zoneTierLabel: string;
      routeName: string;
      suggestedFrequency: string;
      ordersCount: number;
    }> = [];

    for (const c of customers) {
      const anchorId = anchorByCustomer.get(c.id);
      if (!anchorId) continue; // ya contado en skippedNoCoordinates
      const point = c.deliveryPoints[0];
      const warehouse = warehouseById.get(anchorId)!;
      const origin: RoutePoint = { lat: warehouse.lat, lng: warehouse.lng };
      const destination: RoutePoint = { lat: point.lat!, lng: point.lng! };
      const distanceKm = Math.round(haversineKm(origin, destination) * 10) / 10;
      const { tier, label } = classifyDistanceKm(distanceKm);
      const zone = zoneByPair.get(`${c.id}::${anchorId}`);
      const stats = orderStatsByCustomer.get(c.id);

      clients.push({
        id: c.id,
        legalName: c.legalName,
        lat: point.lat!,
        lng: point.lng!,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        distanceKm,
        zoneTier: tier,
        zoneTierLabel: label,
        routeName: zone?.name ?? "Sin circuito asignado",
        // Estos dos campos sí reflejan el histórico real de pedidos -- solo
        // afectan a la ficha de detalle al clicar el cliente, nunca a si el
        // cliente aparece o no en el mapa (ver comentario arriba).
        suggestedFrequency: stats
          ? suggestedFrequencyLabel(stats._count._all, stats._min.createdAt!, stats._max.createdAt!)
          : "Sin pedidos registrados todavía",
        ordersCount: stats?._count._all ?? 0,
      });
    }

    res.json({
      warehouses: geolocatedWarehouses,
      distanceTiers: DISTANCE_TIERS.map((t) => ({ tier: t.tier, label: t.label, maxKm: Number.isFinite(t.maxKm) ? t.maxKm : null })),
      clients,
      skippedNoCoordinates,
      // Fase 16 (aclaración pedida por Raúl: "marca solo 18 clientes frente a
      // los 104 registrados en sistema"): total de clientes activos evaluados
      // por este endpoint, para que el desglose cuadre en el frontend
      // (totalActiveCustomers === clients.length + skippedNoCoordinates
      // siempre). Puede no coincidir con el "104" de la pantalla Clientes:
      // esa pantalla cuenta TODOS los clientes no eliminados (activos e
      // inactivos); este mapa solo evalúa los activos.
      totalActiveCustomers: customers.length,
    });
  })
);
