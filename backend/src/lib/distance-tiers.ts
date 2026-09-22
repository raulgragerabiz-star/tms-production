// Extraído de dashboard.routes.ts (Fase 16, mapa de clientes de Inicio) para
// poder reutilizar exactamente los mismos cortes de distancia en más de una
// pantalla (Fase 19: "Zonas / Vehículos" -> "Criterio de asignación
// ruta/cliente por distancia real") sin arriesgar que diverjan con el
// tiempo. Sin cambios de comportamiento respecto a como vivía inline en
// dashboard.routes.ts -- mismos cortes que el panel de referencia de Raúl
// (0-40 / 40-120 / 120-250 / 250-450 / >450 km). Distinto de InfluenceZone
// (configurable por almacén, pensada para asignar vehículo real): esto es
// una clasificación fija, solo para colorear/agrupar por distancia.
export const DISTANCE_TIERS: { tier: string; label: string; maxKm: number }[] = [
  { tier: "metropolitana", label: "Metropolitana (0-40 km)", maxKm: 40 },
  { tier: "regional_cercana", label: "Regional cercana (40-120 km)", maxKm: 120 },
  { tier: "regional_extendida", label: "Regional extendida (120-250 km)", maxKm: 250 },
  { tier: "larga_distancia", label: "Larga distancia (250-450 km)", maxKm: 450 },
  { tier: "internacional", label: "Internacional (>450 km)", maxKm: Infinity },
];

export function classifyDistanceKm(km: number): { tier: string; label: string } {
  const found = DISTANCE_TIERS.find((t) => km <= t.maxKm)!;
  return { tier: found.tier, label: found.label };
}
