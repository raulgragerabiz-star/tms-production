// Mejora (2026-09-14): "indicar dentro de los pedidos integrados el número
// de bultos/palets que contiene cada pedido... de forma visual" -- petición
// explícita de Raúl, para que el Planificador (y la lista/ficha de Pedidos)
// muestren de un vistazo cuánta mercancía trae cada pedido, no solo su peso.
//
// Fase 11 (corrección explícita de Raúl sobre la fórmula anterior): "las
// dimensiones de los artículos tienen que estar basadas en... palet europeo
// (1.20 x 0.80), contando este como 1 unidad. Si es inferior de tamaño
// contará como 0.5 unidad y si es mayor (doble largo por ejemplo) contará
// como 2 unidades de palet." Antes, `computeLinePallets` SOLO contaba
// "cantidad ÷ unidades por palé", sin mirar el tamaño real del palé del
// producto -- un producto con un palé más grande o más pequeño que el
// europeo contaba exactamente igual que uno estándar, dando una capacidad de
// carga irreal. Ahora se multiplica por `computePalletFootprintFactor`, la
// superficie real del palé de este producto (`lengthM`×`widthM`, ya
// derivadas en metros desde `palletDepthCm`/`palletWidthCm` al guardar el
// producto -- ver `derivePalletMetersFromCm` en products.routes.ts) frente a
// la superficie del palé europeo (1.20×0.80 = 0.96 m²). Sin medidas
// cargadas, el factor es 1 (se asume palé europeo estándar, mismo criterio
// de "sin dato conocido" que ya se usaba para `unitsPerPallet`).
//
// Esta fórmula ahora SÍ se reutiliza en los sitios que antes quedaban fuera
// a propósito -- `recalculateLoadPlan`/auto-plan (routes.routes.ts) y
// `classifyOrder` (segmentation.service.ts) -- porque esta vez el cambio de
// fórmula es justo lo que Raúl ha pedido explícitamente para el motor de
// planificación/capacidad de carga, no solo para una insignia visual.
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
    lengthM?: number | string | null;
    widthM?: number | string | null;
  };
}

const EURO_PALLET_LENGTH_M = 1.2;
const EURO_PALLET_WIDTH_M = 0.8;
const EURO_PALLET_AREA_M2 = EURO_PALLET_LENGTH_M * EURO_PALLET_WIDTH_M; // 0.96 m²

// `lengthM`/`widthM` llegan como `Decimal` de Prisma en el backend (de ahí
// el `string` en el tipo de arriba -- `Decimal` se serializa como string al
// pasar por JSON, y como objeto Decimal dentro del propio backend, pero
// `Number(...)` funciona igual en ambos casos).
export function computePalletFootprintFactor(product: { lengthM?: number | string | null; widthM?: number | string | null }): number {
  const length = product.lengthM != null ? Number(product.lengthM) : null;
  const width = product.widthM != null ? Number(product.widthM) : null;
  if (length == null || width == null || !(length > 0) || !(width > 0)) return 1;
  return (length * width) / EURO_PALLET_AREA_M2;
}

export function computeLinePallets(line: PalletizableLine): number {
  const unitsPerPallet = line.product.unitsPerPallet ?? 1;
  const rawPallets = unitsPerPallet > 0 ? line.quantity / unitsPerPallet : 0;
  return rawPallets * computePalletFootprintFactor(line.product);
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
