// Mejora (2026-09-14): "indicar dentro de los pedidos integrados el número
// de bultos/palets que contiene cada pedido... de forma visual" -- petición
// explícita de Raúl, para que el Planificador (y la lista/ficha de Pedidos)
// muestren de un vistazo cuánta mercancía trae cada pedido, no solo su peso.
//
// Palés: se calcula exactamente con la MISMA fórmula que ya usan
// segmentation.service.ts / routes.routes.ts (`recalculateLoadPlan`) --
// cantidad de la línea ÷ unidades por palé del producto, tratando "sin
// unidades por palé configuradas" como 1 (mismo criterio ya establecido en
// esos dos sitios, no se cambia aquí). Deliberadamente NO se toca ninguno de
// esos dos sitios -- siguen calculando el palé inline como hasta ahora, esta
// función solo se usa en los puntos NUEVOS de esta pieza, para no arriesgar
// ninguna funcionalidad ya operativa (motor de asignación/optimización).
//
// Bultos: concepto nuevo, sin ningún cálculo previo en el proyecto.
// `Product.unitsPerBox` (Fase 8R) todavía no se leía en ningún sitio. A
// diferencia de los palés, aquí NO se aplica el mismo "sin dato = 1": para
// palés esa aproximación ya está asumida y probada en el resto del motor,
// pero para bultos no hay ningún precedente, y forzar un valor inventado
// sería menos honesto que mostrar "sin dato" cuando el producto no tiene
// unidades por caja cargadas todavía (catálogo real en curso, Fase 8R).
export interface PalletizableLine {
  quantity: number;
  product: {
    unitsPerPallet: number | null;
    unitsPerBox?: number | null;
  };
}

export function computeLinePallets(line: PalletizableLine): number {
  const unitsPerPallet = line.product.unitsPerPallet ?? 1;
  return unitsPerPallet > 0 ? line.quantity / unitsPerPallet : 0;
}

/** null = no se puede calcular (el producto no tiene `unitsPerBox` cargado todavía). */
export function computeLineBoxes(line: PalletizableLine): number | null {
  const unitsPerBox = line.product.unitsPerBox;
  if (unitsPerBox == null || unitsPerBox <= 0) return null;
  return line.quantity / unitsPerBox;
}

export interface OrderPalletsSummary {
  totalPallets: number;
  /** null = ninguna línea tiene `unitsPerBox`, no solo que dé 0. */
  totalBoxes: number | null;
}

export function summarizeOrderPallets(lines: PalletizableLine[]): OrderPalletsSummary {
  let totalPallets = 0;
  let totalBoxes = 0;
  let anyBoxesKnown = false;
  for (const line of lines) {
    totalPallets += computeLinePallets(line);
    const boxes = computeLineBoxes(line);
    if (boxes != null) {
      anyBoxesKnown = true;
      totalBoxes += boxes;
    }
  }
  return { totalPallets, totalBoxes: anyBoxesKnown ? totalBoxes : null };
}
