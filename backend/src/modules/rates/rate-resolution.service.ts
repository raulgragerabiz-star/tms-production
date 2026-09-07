// ============================================================================
// Punto de entrada del motor de tarifas (Fase 9): `resolveShipmentCost`.
//
// NOTA IMPORTANTE (hallazgo al reconectar el motor de optimización, v1.1):
// esta función orquestadora se documentaba en varios sitios (rates.routes.ts
// /simulate, billing.routes.ts, routes/optimization.routes.ts) como "ya
// existente", pero no había ninguna implementación real en el código activo
// — los tres módulos importaban un símbolo que no existía, así que
// /api/rates/simulate, el cierre de settlements y la simulación de
// candidatos de ruta fallaban en cuanto se invocaban. Se implementa aquí,
// completando el motor con las piezas que sí existían (computeFullTruckCost,
// computePalletCost, computeFinalRouteCost, el motor de suplementos).
//
// Prioridad de tarifa base (documento 10-gestion-tarifas-TMS.md):
//   1. by_customer  (customer_rate): importe fijo pactado con ese cliente.
//   2. by_zone      (zone_rate, zoneName = provincia): importe fijo por zona.
//   3. general      (full_truck_rate / pallet_rate): fórmula estándar.
//
// `serviceType` acepta tanto los 4 segmentos reales (paqueteria/paleteria/
// paleteria_pesada/gran_volumen, columna `service_type` del schema) como los
// valores heredados "full_truck"/"pallet" que todavía usan algunos llamadores
// (rates.routes.ts, billing.routes.ts) — se normalizan internamente:
//   full_truck | gran_volumen        -> tabla full_truck_rate
//   pallet | paleteria | paleteria_pesada -> tabla pallet_rate
//   paqueteria                       -> sin tabla de tarifa todavía (se
//                                        devuelve null, igual que "sin
//                                        tarifa vigente"); pendiente de
//                                        decisión de negocio.
// ============================================================================
import { prisma } from "@/lib/prisma";
import { ServiceType } from "@prisma/client";

const FULL_TRUCK_SEGMENTS: ServiceType[] = [ServiceType.gran_volumen];
const PALLET_SEGMENTS: ServiceType[] = [ServiceType.paleteria, ServiceType.paleteria_pesada];

function mapsToFullTruck(serviceType: string): boolean {
  return serviceType === "full_truck" || serviceType === ServiceType.gran_volumen;
}

function mapsToPallet(serviceType: string): boolean {
  return (
    serviceType === "pallet" ||
    serviceType === ServiceType.paleteria ||
    serviceType === ServiceType.paleteria_pesada
  );
}

function isCurrentlyValid<T extends { validFrom: Date; validTo: Date | null }>(rows: T[], date: Date): T[] {
  return rows.filter((r) => r.validFrom <= date && (r.validTo == null || r.validTo >= date));
}

export interface ResolveShipmentCostParams {
  carrierId: string;
  /** "full_truck" | "pallet" (heredado) o uno de los 4 segmentos reales. */
  serviceType: string;
  date: Date;
  km?: number;
  stops?: number;
  notesCount?: number;
  looseItems?: number;
  customerId?: string;
  province?: string;
  conditions?: {
    requiresAdr?: boolean;
    isHoliday?: boolean;
    waitingHours?: number;
    tollAmount?: number;
  };
}

export interface ResolvedShipmentCost {
  estimatedCost: number;
  breakdown: {
    baseRateId: string;
    base: Record<string, unknown>;
    surcharges: unknown;
  };
}

export async function resolveShipmentCost(params: ResolveShipmentCostParams): Promise<ResolvedShipmentCost | null> {
  const carrier = await prisma.carrier.findUnique({ where: { id: params.carrierId } });
  if (!carrier) return null;

  const isFullTruck = mapsToFullTruck(params.serviceType);
  const isPallet = mapsToPallet(params.serviceType);
  if (!isFullTruck && !isPallet) return null; // p. ej. "paqueteria": sin tabla de tarifa todavía

  const segments = isFullTruck ? FULL_TRUCK_SEGMENTS : PALLET_SEGMENTS;

  // 1. by_customer (prioridad máxima)
  let baseRateId: string | undefined;
  let baseAmount: number | undefined;
  let baseBreakdown: Record<string, unknown> | undefined;

  if (params.customerId) {
    const rows = await prisma.customerRate.findMany({
      where: { carrierId: params.carrierId, customerId: params.customerId, serviceType: { in: segments } },
    });
    const valid = isCurrentlyValid(rows, params.date);
    if (valid.length > 0) {
      baseRateId = valid[0].id;
      baseAmount = Number(valid[0].fixedAmount);
      baseBreakdown = { source: "by_customer", fixedAmount: baseAmount };
    }
  }

  // 2. by_zone (si no hubo tarifa por cliente)
  if (baseAmount === undefined && params.province) {
    const rows = await prisma.zoneRate.findMany({
      where: { carrierId: params.carrierId, zoneName: params.province, serviceType: { in: segments } },
    });
    const valid = isCurrentlyValid(rows, params.date);
    if (valid.length > 0) {
      baseRateId = valid[0].id;
      baseAmount = Number(valid[0].fixedAmount);
      baseBreakdown = { source: "by_zone", zoneName: params.province, fixedAmount: baseAmount };
    }
  }

  // 3. general (fórmula estándar por camión completo o paletería)
  if (baseAmount === undefined) {
    if (isFullTruck) {
      const rows = await prisma.fullTruckRate.findMany({ where: { carrierId: params.carrierId } });
      const valid = isCurrentlyValid(rows, params.date);
      if (valid.length === 0) return null;
      const rate = valid[0];
      const result = computeFullTruckCost({
        rate: {
          includedKm: Number(rate.includedKm),
          extraStopFee: Number(rate.extraStopFee),
          extraKmFee: Number(rate.extraKmFee),
          serviceMode: "per_trip",
          dailyDedicatedFee: null,
        },
        totalKm: params.km ?? 0,
        stopsCount: params.stops ?? 0,
      });
      baseRateId = rate.id;
      baseAmount = result.totalAmount;
      baseBreakdown = { source: "general_full_truck", ...result };
    } else {
      const rows = await prisma.palletRate.findMany({ where: { carrierId: params.carrierId } });
      const valid = isCurrentlyValid(rows, params.date);
      if (valid.length === 0) return null;
      const rate = valid[0];
      const result = computePalletCost({
        rate: {
          fixedFeePerNote: Number(rate.fixedFeePerNote),
          looseItemFee: Number(rate.looseItemFee),
          maxWeightPerPalletKg: Number(rate.maxWeightPerPalletKg),
        },
        looseItemsCount: params.looseItems ?? params.notesCount ?? 0,
      });
      baseRateId = rate.id;
      baseAmount = result.totalAmount;
      baseBreakdown = { source: "general_pallet", ...result };
    }
  }

  const final = await computeFinalRouteCost({
    baseCost: baseAmount!,
    companyId: carrier.companyId,
    carrierId: params.carrierId,
    routeDate: params.date,
    warehouseProvince: params.province ?? carrier.province ?? null,
    totalKm: params.km ?? 0,
    requiresAdr: params.conditions?.requiresAdr ?? false,
    waitingMinutes: params.conditions?.waitingHours != null ? params.conditions.waitingHours * 60 : undefined,
    tollAmountActual: params.conditions?.tollAmount ?? null,
  });

  return {
    estimatedCost: final.totalAmount,
    breakdown: { baseRateId: baseRateId!, base: baseBreakdown!, surcharges: final.surcharges.items },
  };
}

// ============================================================================
// PARCHE v1.1 sobre rate-resolution.service.ts ya existente (Fase 9).
// Se añade el modo "daily_dedicated" a la función que calcula el importe de
// full_truck_rate. El resto del motor (by_customer > by_zone > general,
// suplementos acumulables) NO se toca — sigue igual.
// ============================================================================

export interface FullTruckRateLike {
  includedKm: number;
  extraStopFee: number;
  extraKmFee: number;
  serviceMode: "per_trip" | "daily_dedicated";
  dailyDedicatedFee: number | null;
}

export interface FullTruckCostInput {
  rate: FullTruckRateLike;
  totalKm: number;
  stopsCount: number;
}

export interface FullTruckCostBreakdown {
  baseAmount: number;
  extraKmAmount: number;
  extraStopAmount: number;
  totalAmount: number;
  mode: "per_trip" | "daily_dedicated";
}

/**
 * Calcula el importe base de camión completo, ANTES de aplicar
 * rate_surcharge (combustible, ADR, festivos, peajes, esperas — ya
 * existentes y sin cambios, documento v1.1 §4.2: "coste a portes ya
 * cubierto por el motor de suplementos existente").
 */
export function computeFullTruckCost(input: FullTruckCostInput): FullTruckCostBreakdown {
  const { rate, totalKm, stopsCount } = input;
  const extraKm = Math.max(0, totalKm - rate.includedKm);
  const extraKmAmount = extraKm * rate.extraKmFee;

  if (rate.serviceMode === "daily_dedicated") {
    if (rate.dailyDedicatedFee == null) {
      throw new Error(
        "full_truck_rate.serviceMode = daily_dedicated requiere dailyDedicatedFee configurado"
      );
    }
    // (config) — por defecto la parada adicional NO se cobra aparte en modo
    // día dedicado (documento v1.1 §4.2). Si el negocio decide lo contrario,
    // basta con activar `chargeStopsInDedicatedMode` (flag futuro, no bloqueante).
    return {
      baseAmount: rate.dailyDedicatedFee,
      extraKmAmount,
      extraStopAmount: 0,
      totalAmount: rate.dailyDedicatedFee + extraKmAmount,
      mode: "daily_dedicated",
    };
  }

  // Modo per_trip: la primera parada va incluida (recogida), solo las
  // adicionales generan extra_stop_fee.
  const extraStops = Math.max(0, stopsCount - 1);
  const extraStopAmount = extraStops * rate.extraStopFee;
  return {
    baseAmount: 0,
    extraKmAmount,
    extraStopAmount,
    totalAmount: extraKmAmount + extraStopAmount,
    mode: "per_trip",
  };
}

// ============================================================================
// Integración con el motor de suplementos (Versión 2 del roadmap,
// 10-gestion-tarifas-TMS.md). Se añade como una capa por encima de
// computeFullTruckCost/computePalletCost, sin modificar su comportamiento
// existente — así el cálculo base sigue siendo testeable de forma aislada.
// ============================================================================

import { computeSurchargesForRoute, SurchargeComputationResult } from "./surcharge.service";

export interface PalletRateLike {
  fixedFeePerNote: number;
  looseItemFee: number;
  maxWeightPerPalletKg: number;
}

export interface PalletCostInput {
  rate: PalletRateLike;
  looseItemsCount: number;
}

export interface PalletCostBreakdown {
  fixedFeeAmount: number;
  looseItemsAmount: number;
  totalAmount: number;
}

/** Cálculo base de paletería — sin cambios respecto al motor ya existente (Fase 9). */
export function computePalletCost(input: PalletCostInput): PalletCostBreakdown {
  const fixedFeeAmount = input.rate.fixedFeePerNote;
  const looseItemsAmount = input.looseItemsCount * input.rate.looseItemFee;
  return {
    fixedFeeAmount,
    looseItemsAmount,
    totalAmount: fixedFeeAmount + looseItemsAmount,
  };
}

export interface FinalCostBreakdown {
  baseCost: number;
  surcharges: SurchargeComputationResult;
  totalAmount: number;
}

/**
 * Punto de entrada único para obtener el coste final (base + suplementos)
 * de una `route`, tanto para `cost_simulation` (Fase 8, motor de
 * optimización) como para `settlement_line` (Fase 4, cierre de shipment).
 * Reutilizar esta función en ambos sitios garantiza que la liquidación
 * final coincide exactamente con lo que se mostró en el comparador de
 * transportistas — cero sorpresas al facturar (documento v1.1, principio
 * ya fijado de "el coste se calcula antes de decidir, no después").
 */
export async function computeFinalRouteCost(params: {
  baseCost: number;
  companyId: string;
  carrierId: string;
  routeDate: Date;
  warehouseProvince: string | null;
  totalKm: number;
  requiresAdr: boolean;
  waitingMinutes?: number;
  tollAmountActual?: number | null;
}): Promise<FinalCostBreakdown> {
  const surcharges = await computeSurchargesForRoute({
    companyId: params.companyId,
    carrierId: params.carrierId,
    routeDate: params.routeDate,
    warehouseProvince: params.warehouseProvince,
    baseAmount: params.baseCost,
    totalKm: params.totalKm,
    requiresAdr: params.requiresAdr,
    waitingMinutes: params.waitingMinutes,
    tollAmountActual: params.tollAmountActual,
  });

  return {
    baseCost: params.baseCost,
    surcharges,
    totalAmount: round2(params.baseCost + surcharges.totalSurcharges),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
