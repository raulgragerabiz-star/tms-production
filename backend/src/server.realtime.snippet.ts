// ============================================================================
// Añadir/ajustar en tu server.ts / index.ts. Socket.io necesita el
// http.Server "de bajo nivel", no la app de Express directamente — si ya
// haces `app.listen(...)`, hay que cambiarlo por `http.createServer(app)`
// primero (Express sigue funcionando exactamente igual encima).
// ============================================================================

import http from "http";
import { initRealtimeServer } from "./realtime/socket-server";
import trackingRoutes from "./modules/tracking/tracking.routes";
import { startScheduledJobs } from "./jobs/scheduler";

// ...

app.use("/api/driver-app", trackingRoutes); // POST .../tracking-events
app.use("/api/tracking", trackingRoutes);   // GET /live

const httpServer = http.createServer(app);
initRealtimeServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Backend + Socket.io escuchando en :${PORT}`);
  startScheduledJobs();
});

// CORS de Socket.io: en Codespaces, el cliente se conecta al mismo
// subdominio *-4000.app.github.dev que ya usa el resto de la API (mismo
// resolveApiBaseUrl() del frontend, sin puerto adicional que abrir).
