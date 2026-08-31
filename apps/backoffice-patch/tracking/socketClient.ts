// apps/backoffice/src/realtime/socketClient.ts

import { io, Socket } from "socket.io-client";

function resolveApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl) return envUrl;
  const { hostname, protocol } = window.location;
  const m = hostname.match(/^(.*)-\d+\.(app\.github\.dev)$/);
  if (m) return `${protocol}//${m[1]}-4000.${m[2]}`;
  return "http://localhost:4000";
}

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(resolveApiBaseUrl(), {
      transports: ["websocket"],
      autoConnect: true,
      auth: {
        token: localStorage.getItem("backoffice_token"), // ajustar a la clave real usada en el proyecto
      },
    });
  }
  return socket;
}

export function subscribeToWarehouse(warehouseId: string) {
  getSocket().emit("subscribe:warehouse", warehouseId);
}

export function unsubscribeFromWarehouse(warehouseId: string) {
  getSocket().emit("unsubscribe:warehouse", warehouseId);
}
