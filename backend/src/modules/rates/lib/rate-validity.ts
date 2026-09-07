// Regla de negocio (Fase 3 §12): dos vigencias de tarifa del mismo transportista+servicio
// nunca pueden solaparse. Extraído como función pura para poder testearse sin BD.
export function rangesOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  const FAR_FUTURE = new Date("9999-12-31");
  const aEnd = aTo ?? FAR_FUTURE;
  const bEnd = bTo ?? FAR_FUTURE;
  return aFrom <= bEnd && bFrom <= aEnd;
}
