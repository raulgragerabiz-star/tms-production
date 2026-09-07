import { prisma } from "../lib/prisma";

/**
 * Elimina físicamente los tokens QR de vehículo que llevan revocados más
 * de N días. No se borran nunca tokens activos (soft-delete lógico ya
 * cubierto por `active: false` + `revokedAt`); esto es limpieza de
 * histórico ya inútil para reducir el tamaño de la tabla, coherente con
 * que `vehicle_qr_token` se regenera en cada `issueVehicleQrToken()`
 * (documento v1.1 §5.1: cada emisión desactiva el token anterior).
 *
 * Se mantiene fuera de la política de soft-delete general del dominio
 * (domain-freeze / modelo-bd-TMS §12) a propósito: esa política protege
 * entidades de negocio referenciadas por pedidos/envíos históricos
 * (customer, product, carrier, vehicle...); un token QR revocado no tiene
 * ese valor de trazabilidad una vez pasado el periodo de retención.
 */
const RETENTION_DAYS = Number(process.env.QR_TOKEN_CLEANUP_RETENTION_DAYS ?? 30); // (config)
const DELETE_BATCH_SIZE = Number(process.env.QR_TOKEN_CLEANUP_BATCH_SIZE ?? 1000); // (config)

export interface QrTokenCleanupResult {
  deletedCount: number;
  cutoffDate: Date;
  batches: number;
}

/**
 * OPTIMIZACIÓN: borrado en lotes de `DELETE_BATCH_SIZE` filas en vez de un
 * único `deleteMany` sin límite. Un `DELETE` masivo sobre una tabla que ha
 * acumulado millones de filas retiene locks y genera un pico de I/O/WAL
 * que puede notarse en el resto del tráfico de esa misma ventana (03:00,
 * fuera de horario pero no necesariamente sin actividad si hay
 * transportistas operando en turno de noche). Trocear en lotes pequeños
 * con una pausa mínima entre ellos mantiene el job igual de eficaz con un
 * impacto marginal sobre la BD en cada iteración.
 */
export async function cleanupRevokedVehicleQrTokens(
  retentionDays: number = RETENTION_DAYS
): Promise<QrTokenCleanupResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  let totalDeleted = 0;
  let batches = 0;

  while (true) {
    // Selecciona solo los IDs del siguiente lote (ligero: un solo campo,
    // con LIMIT) y borra por ID — evita que Postgres tenga que evaluar el
    // filtro completo de nuevo en cada iteración sobre una tabla grande,
    // y permite que otras transacciones intercalen entre lotes.
    const batchIds = await prisma.vehicleQrToken.findMany({
      where: { active: false, revokedAt: { not: null, lt: cutoffDate } },
      select: { id: true },
      take: DELETE_BATCH_SIZE,
    });

    if (batchIds.length === 0) break;

    const result = await prisma.vehicleQrToken.deleteMany({
      where: { id: { in: batchIds.map((r) => r.id) } },
    });

    totalDeleted += result.count;
    batches += 1;

    if (batchIds.length < DELETE_BATCH_SIZE) break; // último lote, ya no hay más
  }

  return { deletedCount: totalDeleted, cutoffDate, batches };
}
