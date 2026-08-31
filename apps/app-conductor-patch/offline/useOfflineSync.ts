// apps/app-conductor/src/offline/useOfflineSync.ts
//
// OPTIMIZACIÓN sobre la versión anterior: el polling fijo cada 5s corría
// de forma indefinida incluso con la cola vacía y la app en segundo plano
// — en un turno de 8h eso son ~5.760 comprobaciones, la inmensa mayoría
// sin nada que hacer. Ahora:
//   1. Solo se activa el polling cuando hay algo pendiente en la cola
//      (getQueueLength() > 0); con la cola vacía, la sincronización
//      depende únicamente de los eventos 'online'/'offline' del navegador
//      (coste cero en reposo).
//   2. El intervalo de reintento pasa de 5s a 20s — el conductor no
//      necesita una latencia de sincronización menor a eso, y reduce el
//      número de wake-ups en 4x mientras hay cola pendiente.
//   3. Se pausa por completo si `document.visibilityState !== "visible"`
//      (app minimizada/pantalla apagada) — se retoma automáticamente al
//      volver a primer plano vía el listener de 'visibilitychange'.

import { useEffect, useState, useCallback, useRef } from "react";
import { flushQueue, getQueueLength, getFailedActionsCount } from "./offlineQueue";

export interface OfflineSyncState {
  isOnline: boolean;
  pendingCount: number;
  failedCount: number;
  syncing: boolean;
}

const POLL_INTERVAL_MS = 20_000; // antes: 5.000 — 4x menos wake-ups

export function useOfflineSync(): OfflineSyncState {
  const [state, setState] = useState<OfflineSyncState>({
    isOnline: navigator.onLine,
    pendingCount: getQueueLength(),
    failedCount: getFailedActionsCount(),
    syncing: false,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sync = useCallback(async () => {
    if (!navigator.onLine) {
      setState((s) => ({ ...s, isOnline: false, pendingCount: getQueueLength() }));
      return;
    }
    setState((s) => ({ ...s, syncing: true }));
    await flushQueue();
    setState({
      isOnline: navigator.onLine,
      pendingCount: getQueueLength(),
      failedCount: getFailedActionsCount(),
      syncing: false,
    });
  }, []);

  const ensurePolling = useCallback(() => {
    const shouldPoll =
      document.visibilityState === "visible" && (getQueueLength() > 0 || !navigator.onLine);

    if (shouldPoll && intervalRef.current == null) {
      intervalRef.current = setInterval(sync, POLL_INTERVAL_MS);
    } else if (!shouldPoll && intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [sync]);

  useEffect(() => {
    async function handleOnline() {
      await sync();
      ensurePolling(); // si la cola queda vacía tras sincronizar, esto la apaga sola
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void sync();
      }
      ensurePolling();
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", ensurePolling);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    sync().then(ensurePolling); // estado inicial al montar

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", ensurePolling);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (intervalRef.current != null) clearInterval(intervalRef.current);
    };
  }, [sync, ensurePolling]);

  // Re-evalúa si hace falta seguir el polling cada vez que cambia el
  // tamaño de la cola (ej. tras un enqueueAction desde otra pantalla).
  useEffect(() => {
    ensurePolling();
  }, [state.pendingCount, ensurePolling]);

  return state;
}
