// Cálculo de peso de línea de pedido (Fase 3, order_line.line_weight_kg):
// si la unidad es "PAL" (palés completos) se usa el peso de palé lleno declarado,
// en cualquier otro caso se multiplica por el peso bruto unitario del producto.
export interface WeightableProduct {
  grossWeightKg: number;
  fullPalletWeightKg: number;
}

export function computeLineWeightKg(unit: string, quantity: number, product: WeightableProduct): number {
  if (unit.toUpperCase() === "PAL") {
    return quantity * product.fullPalletWeightKg;
  }
  return quantity * product.grossWeightKg;
}
