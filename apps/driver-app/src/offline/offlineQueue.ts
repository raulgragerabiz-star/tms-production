// apps/app-conductor/src/offline/offlineQueue.ts
//
// Cola de acciones pendientes de sincronizar. Documento 14-app-conductor-TMS.md,
// §Modo offline: "las acciones realizadas sin cobertura (firma, foto, cambio
// de estado) se guardan localmente y se sincronizan en cuanto hay conexión,
// sin bloquear al conductor".
//
// Diseño deliberadamente simple (localStorage, no IndexedDB/service worker):
// el volumen de acciones por conductor y día es bajo (decenas, no miles), y
// evitar un service worker reduce la superficie de bugs de caché en un
// dispositivo que ya tiene cobertura irregular por sí solo. Si el volumen
// creciera mucho, esto es sustituible por IndexedDB sin cambiar la API
// pública (enqueue/flush) que consume el resto de la app.

import { apiClient } from "@/api/client";

export type QueuedActionType =
  | "confirm_load"
  | "gps_batch"
  | "stop_status_change"
  | "proof_of_delivery"
  | "incident";

export interface QueuedAction {
  id: string; // UUID local, también sirve de clientEventId para endpoints idempotentes
  type: QueuedActionType;
  method: "POST" | "PATCH";
  url: string;
  body: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

const STORAGE_KEY = "tms_driver_offline_queue_v1";
const MAX_ATTEMPTS_BEFORE_FLAG = 5;

function readQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedAction[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

/**
 * Encola una acción para sincronizar. Se llama SIEMPRE, tanto si hay
 * conexión como si no — la app nunca decide en el punto de llamada;
 * `flushQueue()` decide si puede vaciarla ahora o hay que esperar.
 * Esto evita dos rutas de código distintas (online vs. offline) para la
 * misma acción, que es la fuente de bugs más común en apps offline-first.
 */
export function enqueueAction(action: Omit<QueuedAction, "id" | "createdAt" | "attempts">): QueuedAction {
  const queue = readQueue();
  const fullAction: QueuedAction = {
    ...action,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  queue.push(fullAction);
  writeQueue(queue);

  // Intento inmediato en segundo plano — si hay conexión, se resuelve al
  // instante y el conductor ni lo nota; si no, queda en cola sin bloquear.
  void flushQueue();

  return fullAction;
}

export function getQueueLength(): number {
  return readQueue().length;
}

export function getFailedActionsCount(): number {
  return readQueue().filter((a) => a.attempts >= MAX_ATTEMPTS_BEFORE_FLAG).length;
}

let flushing = false;

/**
 * Intenta enviar todas las acciones pendientes, en orden de creación
 * (crítico para gps_batch y stop_status_change, donde el orden cronológico
 * importa). Se detiene en el primer fallo de red genuino (para no generar
 * cientos de intentos fallidos seguidos), pero sigue intentando acciones
 * individuales que fallen por otros motivos (ej. 409 de conflicto), para
 * no bloquear el resto de la cola por una sola acción problemática.
 */
export async function flushQueue(): Promise<{ synced: number; remaining: number }> {
  if (flushing) return { synced: 0, remaining: getQueueLength() };
  if (!navigator.onLine) return { synced: 0, remaining: getQueueLength() };

  flushing = true;
  let synced = 0;

  try {
    let queue = readQueue();

    for (const action of queue) {
      try {
        if (action.method === "POST") {
          await apiClient.post(action.url, action.body);
        } else {
          await apiClient.patch(action.url, action.body);
        }
        synced++;
        queue = queue.filter((a) => a.id !== action.id);
        writeQueue(queue);
      } catch (err: any) {
        const isNetworkError = !err?.response; // sin respuesta = sin conexión real
        if (isNetworkError) {
          // Se aborta el flush entero: no tiene sentido seguir intentando
          // el resto si acabamos de perder la conexión a mitad de sync.
          break;
        }

        // Error de servidor (4xx/5xx con respuesta) — se cuenta el
        // intento y se sigue con la siguiente acción de la cola.
        queue = queue.map((a) =>
          a.id === action.id
            ? { ...a, attempts: a.attempts + 1, lastError: err?.response?.data?.error ?? "unknown_error" }
            : a
        );
        writeQueue(queue);
      }
    }
  } finally {
    flushing = false;
  }

  return { synced, remaining: getQueueLength() };
}

/**
 * Elimina de la cola las acciones que llevan MAX_ATTEMPTS_BEFORE_FLAG
 * intentos fallidos por un error que no es de red (ej. shipment ya
 * cerrado). Se expone como acción manual desde la UI ("descartar
 * pendientes con error"), nunca automática — el conductor/planificador
 * debe poder ver por qué falló antes de perder el dato.
 */
export function discardFailedAction(actionId: string) {
  const queue = readQueue().filter((a) => a.id !== actionId);
  writeQueue(queue);
}

export function getFailedActions(): QueuedAction[] {
  return readQueue().filter((a) => a.attempts >= MAX_ATTEMPTS_BEFORE_FLAG);
}
