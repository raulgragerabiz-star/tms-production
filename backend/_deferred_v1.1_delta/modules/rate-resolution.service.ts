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

  // Modo ya existente (per_trip) — sin cambios de comportamiento.
  const extraStopAmount = stopsCount * rate.extraStopFee;
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
