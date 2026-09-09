import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/store/auth-store";

// Fase 6: canal de empuje inmediato (WebSocket) entre despacho y conductor,
// sumado al sondeo que ya existía (DispatchBoard.tsx/SeguimientoPage.tsx
// siguen con su `refetchInterval` de siempre, sin tocar) -- si este canal no
// se puede abrir o se corta, esas pantallas se siguen actualizando solas, más
// despacio, exactamente igual que antes de esta fase. Este hook nunca es
// necesario para que la pantalla funcione, solo la hace más inmediata.

type RealtimeStatus = "connecting" | "live" | "offline";

interface RealtimeMessage {
  type: string;
  payload: unknown;
  ts: string;
}

/**
 * Misma idea que resolveApiBaseUrl() de api/client.ts (reescribir el puerto
 * en Codespaces), pero para el protocolo ws(s):// en vez de http(s)://.
 */
function resolveWsUrl(): string {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;

  const { hostname, protocol } = window.location;
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  const codespacesMatch = hostname.match(/^(.*)-\d+\.(app\.github\.dev)$/);
  if (codespacesMatch) {
    return `${wsProtocol}//${codespacesMatch[1]}-4000.${codespacesMatch[2]}/ws`;
  }
  return `${wsProtocol}//localhost:4000/ws`;
}

/**
 * Se conecta al WebSocket del backend y se suscribe a la sala de un almacén
 * (`warehouseId`) o de un envío (`shipmentId`). Reconecta solo con backoff
 * simple si se corta. Llama a `onMessage` por cada evento recibido -- quien
 * use el hook decide qué hacer con cada `type` (normalmente, actualizar la
 * cache de React Query con `queryClient.setQueryData`).
 */
export function useRealtimeChannel(
  scope: { warehouseId?: string } | { shipmentIds?: string[] } | null,
  onMessage: (msg: RealtimeMessage) => void
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const warehouseId = scope && "warehouseId" in scope ? scope.warehouseId : undefined;
  // Ordenado para que la clave de dependencia del efecto sea estable aunque
  // el array llegue en distinto orden entre renders (p. ej. Seguimiento,
  // suscrito a varios envíos a la vez, uno por cada envío en curso).
  const shipmentIds = scope && "shipmentIds" in scope ? [...(scope.shipmentIds ?? [])].sort() : [];
  const shipmentIdsKey = shipmentIds.join(",");

  useEffect(() => {
    if (!warehouseId && shipmentIds.length === 0) {
      setStatus("offline");
      return;
    }
    const token = useAuthStore.getState().token;
    if (!token) {
      setStatus("offline");
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let attempt = 0;

    function connect() {
      if (cancelled) return;
      setStatus("connecting");
      try {
        socket = new WebSocket(`${resolveWsUrl()}?token=${encodeURIComponent(token!)}`);
      } catch {
        setStatus("offline");
        return;
      }

      socket.onopen = () => {
        attempt = 0;
        if (warehouseId) {
          socket?.send(JSON.stringify({ type: "subscribe", warehouseId }));
        } else {
          for (const shipmentId of shipmentIds) socket?.send(JSON.stringify({ type: "subscribe", shipmentId }));
        }
      };
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as RealtimeMessage;
          if (msg.type === "subscribed") {
            setStatus("live");
            return;
          }
          if (msg.type === "connected" || msg.type === "error") return;
          onMessageRef.current(msg);
        } catch {
          // mensaje no reconocible -- se ignora, nunca debe romper la pantalla
        }
      };
      socket.onclose = () => {
        if (cancelled) return;
        setStatus("offline");
        attempt += 1;
        const delay = Math.min(1000 * 2 ** attempt, 15000);
        reconnectTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => {
        socket?.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, shipmentIdsKey]);

  return status;
}
