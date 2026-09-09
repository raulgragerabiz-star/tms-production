import { createServer } from "http";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { initRealtimeServer } from "@/realtime/ws.server";

// Fase 6: antes se llamaba directamente `createApp().listen(...)`. Se envuelve
// la app en un `http.Server` explícito para poder enganchar el servidor
// WebSocket (tiempo real despacho<->conductor) al mismo puerto, sin abrir un
// segundo puerto ni tocar CORS/Codespaces -- todo el tráfico HTTP normal
// sigue funcionando exactamente igual.
const app = createApp();
const httpServer = createServer(app);
initRealtimeServer(httpServer);

httpServer.listen(env.port, () => {
  console.log(`Backend TMS escuchando en :${env.port} (HTTP + WebSocket /ws)`);
});
