// Cálculo de peso de línea de pedido (Fase 3, order_line.line_weight_kg):
// si la unidad es "PAL" (palés completos) se usa el peso de palé lleno declarado,
// en cualquier otro caso se multiplica por el peso bruto unitario del producto.
//
// Fase 8R: grossWeightKg/fullPalletWeightKg dejaron de ser obligatorios en
// Product (el nuevo formato de catálogo no siempre trae peso, ver
// schema.prisma) -- si el dato que hace falta no está, se devuelve `null`
// ("peso desconocido") en vez de calcular con 0, para que quien reciba el
// resultado (OrderLine.lineWeightKg, ya opcional, y el PDF de albarán/carta
// de porte) pueda mostrar "—" en vez de un peso 0kg engañoso.
export interface WeightableProduct {
  grossWeightKg: number | null;
  fullPalletWeightKg: number | null;
}

export function computeLineWeightKg(unit: string, quantity: number, product: WeightableProduct): number | null {
  const perUnit = unit.toUpperCase() === "PAL" ? product.fullPalletWeightKg : product.grossWeightKg;
  if (perUnit == null) return null;
  return quantity * perUnit;
}
