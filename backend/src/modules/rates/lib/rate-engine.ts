// Motor de tarifas avanzado (Fase 9): extensión aditiva del modelo real (km+parada /
// albarán+bulto) que añade resolución por prioridad y suplementos acumulables, sin
// romper el caso simple. Todo aquí son funciones puras, sin acceso a BD, para que la
// lógica de negocio (que es la que decide cuánto se le paga a un transportista) sea
// 100% testeable de forma determinista.

export type SurchargeType = "fuel" | "adr" | "holiday" | "toll" | "waiting_time" | "zone";
export type CalculationMode = "fixed" | "percentage" | "per_km" | "per_hour";

export interface Surcharge {
  id: string;
  surchargeType: SurchargeType;
  calculationMode: CalculationMode;
  value: number;
}

// Condiciones concretas del pedido/ruta que determinan qué suplementos aplican y
// con qué magnitud (Fase 9: "combustible %, ADR fijo/%, temperatura fijo, esperas
// por hora, retornos, peajes real/estimado, festivos % sobre base").
export interface ShipmentConditions {
  km?: number;
  requiresAdr?: boolean;
  isHoliday?: boolean;
  waitingHours?: number;
  tollAmount?: number;
  includesReturnPickup?: boolean;
}

export interface SurchargeLineResult {
  surchargeId: string;
  surchargeType: SurchargeType;
  amount: number;
}

// Determina si un suplemento es aplicable dadas las condiciones del envío. Los tipos
// "fuel" y "zone" se consideran siempre aplicables (recargos generales); el resto
// depende de una condición explícita para no cobrar de más por defecto.
export function isSurchargeApplicable(surcharge: Surcharge, conditions: ShipmentConditions): boolean {
  switch (surcharge.surchargeType) {
    case "adr":
      return !!conditions.requiresAdr;
    case "holiday":
      return !!conditions.isHoliday;
    case "waiting_time":
      return (conditions.waitingHours ?? 0) > 0;
    case "toll":
      return (conditions.tollAmount ?? 0) > 0;
    case "fuel":
    case "zone":
      return true;
    default:
      return false;
  }
}

// Calcula el importe de UN suplemento ya confirmado como aplicable, sobre una base
// (coste base ya resuelto por prioridad, antes de suplementos).
export function computeSurchargeAmount(surcharge: Surcharge, baseAmount: number, conditions: ShipmentConditions): number {
  switch (surcharge.calculationMode) {
    case "fixed":
      // Los peajes fijos usan el importe real informado si existe (más preciso que el
      // valor genérico configurado en la tarifa).
      if (surcharge.surchargeType === "toll" && conditions.tollAmount !== undefined) {
        return conditions.tollAmount;
      }
      return surcharge.value;
    case "percentage":
      return baseAmount * (surcharge.value / 100);
    case "per_km":
      return (conditions.km ?? 0) * surcharge.value;
    case "per_hour":
      return (conditions.waitingHours ?? 0) * surcharge.value;
    default:
      return 0;
  }
}

// Aplica todos los suplementos vigentes y aplicables sobre una base ya resuelta,
// devolviendo el desglose línea a línea (Fase 9: "todo cálculo guarda el desglose
// completo... imprescindible para auditar o disputar una liquidación").
export function applySurcharges(
  baseAmount: number,
  surcharges: Surcharge[],
  conditions: ShipmentConditions
): { total: number; lines: SurchargeLineResult[] } {
  const lines: SurchargeLineResult[] = [];
  let total = baseAmount;

  for (const s of surcharges) {
    if (!isSurchargeApplicable(s, conditions)) continue;
    const amount = computeSurchargeAmount(s, baseAmount, conditions);
    lines.push({ surchargeId: s.id, surchargeType: s.surchargeType, amount });
    total += amount;
  }

  return { total, lines };
}

// Orden de prioridad de resolución de tarifa base (Fase 9 §"Resolución de precio"):
// 1. by_customer  2. by_route (no modelado aún, ver 🔧 nota en schema)  3. by_zone/by_province
// 4. tarifa base general del transportista. Esta función solo decide CUÁL de las bases
// candidatas gana; el cálculo del importe de cada una se hace fuera (depende del tipo).
export type BaseRateCandidate =
  | { kind: "customer"; amount: number; id: string }
  | { kind: "zone"; amount: number; id: string }
  | { kind: "general"; amount: number; id: string };

export function resolveBaseRate(candidates: {
  customer?: BaseRateCandidate;
  zone?: BaseRateCandidate;
  general?: BaseRateCandidate;
}): BaseRateCandidate {
  if (candidates.customer) return candidates.customer;
  if (candidates.zone) return candidates.zone;
  if (candidates.general) return candidates.general;
  throw new Error("No hay ninguna tarifa base disponible (ni por cliente, ni por zona, ni general)");
}
