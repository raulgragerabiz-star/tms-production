// Fase 6: sincronización en tiempo real despacho<->conductor vía WebSocket.
//
// Hasta ahora todo el "tiempo real" del proyecto era sondeo (React Query
// `refetchInterval`, cada 15-30s según pantalla) -- funcional, pero con
// retraso. Este servidor añade un canal de empuje inmediato SIN quitar el
// sondeo existente en ningún sitio: cada pantalla que se conecta aquí sigue
// teniendo su `refetchInterval` como red de seguridad (si el WebSocket se cae,
// la pantalla se sigue actualizando sola, solo que más despacio) -- ver
// frontend/src/lib/realtime.ts y su uso en DispatchBoard.tsx/SeguimientoPage.tsx.
//
// Ya existía un diseño pensado para esto con socket.io (ver
// backend/_deferred_v1.1_delta/other/realtime/socket-server.ts, nunca
// aplicado) -- aquí se usa la librería `ws`, más ligera, sin arrastrar una
// dependencia adicional del lado del navegador (el cliente nativo
// `WebSocket` ya existe en cualquier navegador moderno). El contrato de
// eventos (posición, incidencia, cambio de estado) sigue la misma idea de
// "salas" por almacén/envío que aquel diseño, por coherencia.
import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import { verifyToken, JwtPayload } from "@/modules/auth/auth.service";
import { prisma } from "@/lib/prisma";

interface TrackedSocket extends WebSocket {
  auth?: JwtPayload;
  rooms?: Set<string>;
  isAlive?: boolean;
}

const roomSockets = new Map<string, Set<TrackedSocket>>();
const HEARTBEAT_MS = 30_000;

function joinRoom(room: string, socket: TrackedSocket) {
  if (!roomSockets.has(room)) roomSockets.set(room, new Set());
  roomSockets.get(room)!.add(socket);
  socket.rooms?.add(room);
}

function leaveAllRooms(socket: TrackedSocket) {
  for (const room of socket.rooms ?? []) {
    roomSockets.get(room)?.delete(socket);
    if (roomSockets.get(room)?.size === 0) roomSockets.delete(room);
  }
}

function send(socket: WebSocket, type: string, payload: unknown) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type, payload, ts: new Date().toISOString() }));
}

function broadcast(room: string, type: string, payload: unknown) {
  const sockets = roomSockets.get(room);
  if (!sockets) return;
  for (const socket of sockets) send(socket, type, payload);
}

export function broadcastToWarehouse(warehouseId: string, type: string, payload: unknown) {
  broadcast(`warehouse:${warehouseId}`, type, payload);
}

export function broadcastToShipment(shipmentId: string, type: string, payload: unknown) {
  broadcast(`shipment:${shipmentId}`, type, payload);
}

// Comprueba que el usuario autenticado puede suscribirse a esa sala concreta
// -- sin esto, cualquier cliente con un token válido (de cualquier empresa)
// podría escuchar la posición en vivo de otra empresa con solo adivinar un
// UUID de almacén o envío.
async function canSubscribe(auth: JwtPayload, msg: { warehouseId?: string; shipmentId?: string }): Promise<string | null> {
  if (msg.warehouseId) {
    const warehouse = await prisma.warehouse.findFirst({ where: { id: msg.warehouseId, companyId: auth.companyId } });
    return warehouse ? `warehouse:${msg.warehouseId}` : null;
  }
  if (msg.shipmentId) {
    const shipment = await prisma.shipment.findFirst({
      where: {
        id: msg.shipmentId,
        OR: [
          { carrier: { companyId: auth.companyId } },
          ...(auth.driverId ? [{ driverId: auth.driverId }] : []),
          ...(auth.carrierId ? [{ carrierId: auth.carrierId }] : []),
        ],
      },
    });
    return shipment ? `shipment:${msg.shipmentId}` : null;
  }
  return null;
}

export function initRealtimeServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (rawSocket, req) => {
    const socket = rawSocket as TrackedSocket;
    socket.rooms = new Set();
    socket.isAlive = true;

    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const token = url.searchParams.get("token") ?? "";
      socket.auth = verifyToken(token);
    } catch {
      send(socket, "error", { message: "Token inválido o expirado" });
      socket.close(4001, "unauthorized");
      return;
    }

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", async (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg?.type === "subscribe" && socket.auth) {
        const room = await canSubscribe(socket.auth, msg);
        if (room) {
          joinRoom(room, socket);
          send(socket, "subscribed", { room });
        } else {
          send(socket, "error", { message: "No autorizado para suscribirse a esa sala" });
        }
      }
    });

    socket.on("close", () => leaveAllRooms(socket));
    socket.on("error", () => leaveAllRooms(socket));

    send(socket, "connected", {});
  });

  // Late-mata conexiones zombis (p. ej. el portátil del despacho se ha ido a
  // suspender sin cerrar la pestaña) -- sin esto, roomSockets acumularía
  // sockets muertos indefinidamente.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const socket = client as TrackedSocket;
      if (socket.isAlive === false) {
        leaveAllRooms(socket);
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);

  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}
