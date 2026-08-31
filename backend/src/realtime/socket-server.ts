import { Server as HttpServer } from "http";
import { Server as SocketIoServer } from "socket.io";

/**
 * Capa de tiempo real, deliberadamente fina: no contiene lógica de
 * negocio, solo pub/sub. El resto del backend (tracking.service.ts,
 * incidents, etc.) importa `broadcastToWarehouse()` para emitir, nunca al
 * revés — mismo principio de dependencia unidireccional ya fijado en
 * Fase 2 (IA/BI consumen eventos, nunca los producen).
 *
 * Alcance: "near-real-time vía eventos, no polling agresivo" para la zona
 * "En curso" del Dashboard (07-dashboard-TMS.md) y para Seguimiento
 * (Pantalla 6). Rooms por `warehouseId` porque el Dashboard/Seguimiento ya
 * se filtran por almacén cuando el usuario tiene acceso a más de uno
 * (mismo comportamiento ya descrito en Fase 6).
 */

let io: SocketIoServer | null = null;

export function initRealtimeServer(httpServer: HttpServer) {
  io = new SocketIoServer(httpServer, {
    cors: {
      // Mismo criterio de CORS ya usado para las 4 apps frontend
      // (Codespaces subdomains + localhost); reutilizar la lista de
      // orígenes permitidos ya definida en tu app.ts.
      origin: (origin, callback) => callback(null, true), // sustituir por tu whitelist real
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    socket.on("subscribe:warehouse", (warehouseId: string) => {
      socket.join(`warehouse:${warehouseId}`);
    });

    socket.on("unsubscribe:warehouse", (warehouseId: string) => {
      socket.leave(`warehouse:${warehouseId}`);
    });

    socket.on("subscribe:shipment", (shipmentId: string) => {
      socket.join(`shipment:${shipmentId}`);
    });

    socket.on("unsubscribe:shipment", (shipmentId: string) => {
      socket.leave(`shipment:${shipmentId}`);
    });
  });

  console.log("[realtime] Socket.io server initialized");
  return io;
}

export interface PositionUpdatePayload {
  shipmentId: string;
  vehicleId: string;
  carrierName: string;
  lat: number;
  lng: number;
  occurredAt: string;
  nextStop?: { routeStopId: string; etaMinutes: number | null; etaSource?: string } | null;
}

export function broadcastPositionUpdate(warehouseId: string, payload: PositionUpdatePayload) {
  io?.to(`warehouse:${warehouseId}`).emit("position_update", payload);
}

export interface IncidentAlertPayload {
  incidentId: string;
  shipmentId: string;
  routeStopId: string | null;
  incidentType: string;
  description: string;
}

export function broadcastIncidentAlert(warehouseId: string, payload: IncidentAlertPayload) {
  io?.to(`warehouse:${warehouseId}`).emit("incident_alert", payload);
}

/**
 * Chat por envío (13-portal-transportista-TMS.md). Room dedicada por
 * shipment (no por warehouse, a diferencia de posiciones/incidencias) para
 * que solo los dos lados de esa conversación concreta reciban el mensaje
 * — el cliente (backoffice o carrier-portal) hace `subscribe:shipment` al
 * abrir el panel de chat de ese envío.
 */
export function broadcastShipmentMessage(shipmentId: string, message: unknown) {
  io?.to(`shipment:${shipmentId}`).emit("shipment_message", message);
}
