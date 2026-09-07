/**
 * Cache in-memory con TTL, sin dependencias externas (no se añade Redis
 * solo para esto — coherente con la filosofía ya aplicada al scheduler de
 * jobs: infraestructura mínima para el volumen actual del proyecto).
 *
 * Uso previsto: datos que se leen muchas veces por segundo/minuto pero
 * cambian con muy poca frecuencia (reglas de segmentación, calendario de
 * festivos, índice de combustible) — evita repetir la misma consulta a
 * BD cientos de veces dentro de un mismo import masivo o una misma
 * ventana de planificación.
 *
 * Si el backend llega a correr en múltiples instancias (Versión
 * Enterprise), este cache deja de compartirse entre procesos; en ese
 * momento se sustituye por Redis sin cambiar la firma pública
 * (`getOrLoad`), solo la implementación interna.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export async function getOrLoad<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }

  const value = await loader();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** Invalidación explícita — usar tras cualquier mutación sobre el dato cacheado. */
export function invalidate(key: string) {
  store.delete(key);
}

export function invalidateByPrefix(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
