/**
 * Fase 6 (integración OpenRouteService): cache compartida específica para las
 * llamadas a proveedores externos (geocodificación, rutas, optimización).
 * Deliberadamente un módulo NUEVO y separado de lib/memory-cache.ts (que ya
 * usan otras partes del backend, como el bridge de importación ERP Claude) en
 * vez de tocar ese fichero -- así ningún llamador existente cambia de
 * comportamiento, y este módulo puede evolucionar libremente.
 *
 * Diseño: si REDIS_URL está configurada (env.redisUrl), usa Redis de verdad
 * (necesario en cuanto haya más de una instancia del backend, y para no
 * perder la cache cada vez que se reinicia el proceso). Si no, cae de forma
 * transparente a una cache en memoria con TTL (misma idea que memory-cache.ts,
 * implementación independiente) -- así esta fase funciona igual de bien desde
 * el primer minuto aunque todavía no haya un Redis desplegado, y empieza a
 * usarlo en cuanto se rellene REDIS_URL en el .env, sin tocar código.
 *
 * Cualquier fallo de Redis (conexión caída, timeout, credenciales mal puestas)
 * se trata como "cache vacía" -- nunca debe romper una petición real por un
 * problema de la cache, que por definición es un dato prescindible y
 * recalculable.
 */
import { env } from "@/config/env";

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();

function memoryGet<T>(key: string): T | undefined {
  const hit = memoryStore.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function memorySet(key: string, value: unknown, ttlMs: number) {
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// Cliente Redis perezoso: solo se crea (y solo se intenta `require`) si hay
// REDIS_URL configurada, para que `ioredis` sea una dependencia opcional en
// la práctica -- un despliegue sin Redis nunca intenta cargarla ni conectar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisClient: any = null;
let redisReady = false;

function getRedisClient() {
  if (!env.redisUrl) return null;
  if (redisClient) return redisClient;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require("ioredis");
    redisClient = new Redis(env.redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => Math.min(times * 200, 2000),
    });
    redisClient.on("ready", () => {
      redisReady = true;
    });
    redisClient.on("error", (err: Error) => {
      redisReady = false;
      // eslint-disable-next-line no-console
      console.warn("[shared-cache] Redis no disponible, se sigue con cache en memoria:", err.message);
    });
    return redisClient;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[shared-cache] REDIS_URL configurada pero el paquete 'ioredis' no está instalado; usando cache en memoria.");
    return null;
  }
}

/**
 * Lee `key`; si no hay valor en cache (o ha caducado), ejecuta `loader()`,
 * guarda el resultado con el TTL indicado y lo devuelve. Misma firma que
 * `getOrLoad` de lib/memory-cache.ts a propósito, para que resulte familiar.
 */
export async function getOrLoadShared<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const redis = getRedisClient();
  if (redis && redisReady) {
    try {
      const raw = await redis.get(key);
      if (raw != null) return JSON.parse(raw) as T;
    } catch (err) {
      // Fallo leyendo Redis -- se sigue como si no hubiera cache, nunca se
      // propaga el error al llamador real.
    }
  } else {
    const cached = memoryGet<T>(key);
    if (cached !== undefined) return cached;
  }

  const value = await loader();

  if (redis && redisReady) {
    try {
      await redis.set(key, JSON.stringify(value), "PX", ttlMs);
    } catch {
      // Igual que arriba: un fallo escribiendo en Redis no debe tumbar la
      // petición que ya tiene su resultado correcto en `value`.
    }
  } else {
    memorySet(key, value, ttlMs);
  }

  return value;
}

/** Lectura sin cargar -- usada para datos "mejor si están" (p. ej. la geometría de una
 * ruta ya calculada) que no deben disparar un recálculo si todavía no existen. */
export async function getShared<T>(key: string): Promise<T | undefined> {
  const redis = getRedisClient();
  if (redis && redisReady) {
    try {
      const raw = await redis.get(key);
      return raw != null ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  }
  return memoryGet<T>(key);
}

export async function setShared(key: string, value: unknown, ttlMs: number): Promise<void> {
  const redis = getRedisClient();
  if (redis && redisReady) {
    try {
      await redis.set(key, JSON.stringify(value), "PX", ttlMs);
      return;
    } catch {
      // cae a memoria si Redis falla al escribir
    }
  }
  memorySet(key, value, ttlMs);
}
