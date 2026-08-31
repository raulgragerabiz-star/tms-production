import { prisma } from "../../lib/prisma";
import { isHoliday } from "./holiday-calendar.service";

export type SurchargeType = "fuel" | "adr" | "holiday" | "toll" | "waiting_time" | "zone";
export type CalculationMode = "fixed" | "percentage" | "per_km" | "per_hour";

export interface RateSurchargeLike {
  id: string;
  surchargeType: SurchargeType;
  calculationMode: CalculationMode;
  value: number;
  baselineValue: number | null; // solo fuel
  franchiseMinutes: number | null; // solo waiting_time
}

export interface SurchargeContext {
  baseAmount: number; // importe base ya calculado (full_truck o pallet), sobre el que se aplican los % 
  totalKm: number;
  requiresAdr: boolean;
  isHolidayDate: boolean;
  waitingMinutes: number;
  tollAmountActual: number | null;
  currentFuelIndexValue: number | null;
}

export interface SurchargeLineResult {
  surchargeId: string;
  surchargeType: SurchargeType;
  amount: number;
  detail: string; // texto auditable, ej. "3.2% combustible (índice 1.45 vs base 1.30)"
}

export interface SurchargeComputationResult {
  items: SurchargeLineResult[];
  totalSurcharges: number;
}

/**
 * Función pura — documento 10-gestion-tarifas-TMS.md, "Sobre la tarifa base
 * se aplican suplementos acumulables". Cada suplemento se evalúa de forma
 * independiente y solo se incluye en el resultado si es APLICABLE a este
 * contexto concreto (ej. ADR solo si el pedido lo requiere) — un suplemento
 * configurado pero no aplicable no genera línea de coste ni entra en el
 * desglose, para no confundir al planificador con importes a cero.
 */
export function computeApplicableSurcharges(
  surcharges: RateSurchargeLike[],
  context: SurchargeContext
): SurchargeComputationResult {
  const items: SurchargeLineResult[] = [];

  for (const s of surcharges) {
    const line = computeOneSurcharge(s, context);
    if (line) items.push(line);
  }

  const totalSurcharges = items.reduce((sum, i) => sum + i.amount, 0);
  return { items, totalSurcharges };
}

function computeOneSurcharge(
  s: RateSurchargeLike,
  ctx: SurchargeContext
): SurchargeLineResult | null {
  switch (s.surchargeType) {
    case "fuel": {
      if (ctx.currentFuelIndexValue == null || s.baselineValue == null || s.baselineValue === 0) {
        return null; // sin índice configurado, no se puede aplicar de forma auditable
      }
      const ratio = ctx.currentFuelIndexValue / s.baselineValue;
      const deviationPct = (ratio - 1) * 100;
      if (Math.abs(deviationPct) < 0.01) return null; // sin desviación relevante, no genera línea

      const amount = ctx.baseAmount * (s.value / 100) * (deviationPct / 100);
      return {
        surchargeId: s.id,
        surchargeType: "fuel",
        amount: round2(amount),
        detail: `Combustible: índice ${ctx.currentFuelIndexValue} vs base ${s.baselineValue} (${deviationPct.toFixed(2)}%)`,
      };
    }

    case "adr": {
      if (!ctx.requiresAdr) return null;
      const amount = s.calculationMode === "percentage" ? ctx.baseAmount * (s.value / 100) : s.value;
      return {
        surchargeId: s.id,
        surchargeType: "adr",
        amount: round2(amount),
        detail: `ADR (mercancía peligrosa): ${s.calculationMode === "percentage" ? `${s.value}%` : `${s.value} fijo`}`,
      };
    }

    case "holiday": {
      if (!ctx.isHolidayDate) return null;
      const amount = s.calculationMode === "percentage" ? ctx.baseAmount * (s.value / 100) : s.value;
      return {
        surchargeId: s.id,
        surchargeType: "holiday",
        amount: round2(amount),
        detail: `Festivo: ${s.calculationMode === "percentage" ? `${s.value}%` : `${s.value} fijo`}`,
      };
    }

    case "toll": {
      const amount = ctx.tollAmountActual ?? s.value; // real si se conoce, si no, estimado configurado
      if (amount <= 0) return null;
      return {
        surchargeId: s.id,
        surchargeType: "toll",
        amount: round2(amount),
        detail: ctx.tollAmountActual != null ? "Peaje (importe real)" : "Peaje (importe estimado)",
      };
    }

    case "waiting_time": {
      const franchise = s.franchiseMinutes ?? 0;
      const billableMinutes = Math.max(0, ctx.waitingMinutes - franchise);
      if (billableMinutes === 0) return null;
      const billableHours = billableMinutes / 60;
      const amount = billableHours * s.value; // value = importe/hora
      return {
        surchargeId: s.id,
        surchargeType: "waiting_time",
        amount: round2(amount),
        detail: `Espera: ${billableMinutes} min facturables (franquicia ${franchise} min) a ${s.value}/h`,
      };
    }

    case "zone": {
      // Reservado — el modelo `by_zone` ya se resuelve en la selección de
      // tarifa base (rate-resolution.service.ts, prioridad 3), no como
      // suplemento acumulable; esta rama existe para no romper el enum si
      // en el futuro se decide modelarlo también como recargo.
      return null;
    }

    default:
      return null;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Wrapper que resuelve el contexto real desde BD y llama a la función pura.
 * Se invoca desde el motor de optimización (cost_simulation) y desde el
 * cierre de shipment (settlement_line) — mismo cálculo en ambos puntos,
 * documento v1.1 ya fijaba que settlement_line debe usar la tarifa vigente
 * en la fecha real del viaje, nunca la actual.
 */
export async function computeSurchargesForRoute(params: {
  companyId: string;
  carrierId: string;
  routeDate: Date;
  warehouseProvince: string | null;
  baseAmount: number;
  totalKm: number;
  requiresAdr: boolean;
  waitingMinutes?: number;
  tollAmountActual?: number | null;
}): Promise<SurchargeComputationResult> {
  const [surcharges, holidayFlag, fuelReading] = await Promise.all([
    prisma.rateSurcharge.findMany({
      where: {
        companyId: params.companyId,
        carrierId: params.carrierId,
        valid_from: { lte: params.routeDate } as any, // ajustar nombre real del campo (validFrom)
      },
    }),
    isHoliday(params.companyId, params.routeDate, params.warehouseProvince),
    prisma.fuelIndexReading.findFirst({
      where: { companyId: params.companyId, effectiveOn: { lte: params.routeDate } },
      orderBy: { effectiveOn: "desc" },
    }),
  ]);

  const context: SurchargeContext = {
    baseAmount: params.baseAmount,
    totalKm: params.totalKm,
    requiresAdr: params.requiresAdr,
    isHolidayDate: holidayFlag,
    waitingMinutes: params.waitingMinutes ?? 0,
    tollAmountActual: params.tollAmountActual ?? null,
    currentFuelIndexValue: fuelReading ? Number(fuelReading.indexValue) : null,
  };

  const surchargeLikes: RateSurchargeLike[] = surcharges.map((s) => ({
    id: s.id,
    surchargeType: s.surchargeType as SurchargeType,
    calculationMode: s.calculationMode as CalculationMode,
    value: Number(s.value),
    baselineValue: (s as any).baselineValue != null ? Number((s as any).baselineValue) : null,
    franchiseMinutes: (s as any).franchiseMinutes ?? null,
  }));

  return computeApplicableSurcharges(surchargeLikes, context);
}
