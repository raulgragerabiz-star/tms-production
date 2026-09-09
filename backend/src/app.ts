import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "@/config/env";
import { errorHandler } from "@/middleware/error-handler";

import { authRouter } from "@/modules/auth/auth.routes";
import { customersRouter } from "@/modules/customers/customers.routes";
import { deliveryPointsRouter } from "@/modules/delivery-points/delivery-points.routes";
import { productsRouter } from "@/modules/products/products.routes";
import { carriersRouter } from "@/modules/carriers/carriers.routes";
import { vehiclesRouter } from "@/modules/vehicles/vehicles.routes";
import { ratesRouter } from "@/modules/rates/rates.routes";
import { ordersRouter } from "@/modules/orders/orders.routes";
import { routesRouter } from "@/modules/routes/routes.routes";
import { shipmentsRouter } from "@/modules/shipments/shipments.routes";
import { returnsRouter } from "@/modules/returns/returns.routes";
import { billingRouter } from "@/modules/billing/billing.routes";
import { dashboardRouter } from "@/modules/dashboard/dashboard.routes";
import { warehousesRouter } from "@/modules/warehouses/warehouses.routes";
import { zonesRouter } from "@/modules/zones/zones.routes";
import { carrierPortalRouter } from "@/modules/portal/carrier-portal.routes";
import { driverAppRouter } from "@/modules/portal/driver-app.routes";
import { customerPortalRouter } from "@/modules/portal/customer-portal.routes";
import { usersRouter } from "@/modules/users/users.routes";
import { optimizationRouter } from "@/modules/routes/optimization.routes";
import erpclaudRouter from "@/modules/integrations/erpclaud/erpclaud.routes";
import { trackingRouter } from "@/modules/tracking/tracking.routes";
import { anomalyRouter } from "@/modules/intelligence/anomaly.routes";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";

// CORS en Codespaces con lista fija (CORS_ORIGIN): cada vez que se recrea o
// se hace rebuild del Codespace, el nombre del host cambia (ej.
// "upgraded-fiesta-xxxx.github.dev" pasa a llamarse de otra forma), y el
// .env se queda con un origen que ya no existe -- así se rompió la consulta
// pública de estado (/seguimiento en el Portal Cliente, puerto 5176): el
// frontend cargaba bien, pero la llamada a la API la bloqueaba CORS porque
// el origen real ya no coincidía con el guardado en CORS_ORIGIN.
//
// En vez de pedir que se actualice el .env cada vez, se admite automáticamente
// cualquier origen de Codespaces para los puertos que ya usan las apps de
// este proyecto (4000 backend, 5173 Backoffice, 5174 Portal Transportista,
// 5175 App Conductor, 5176 Portal Cliente) -- CORS_ORIGIN se mantiene tal
// cual para cualquier otro origen (ej. un dominio propio en producción).
const CODESPACES_ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+-(4000|5173|5174|5175|5176)\.app\.github\.dev$/;

function isKnownCodespacesOrigin(origin: string): boolean {
  return CODESPACES_ORIGIN_PATTERN.test(origin);
}

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Sin origin (curl, health-checks, apps móviles nativas) siempre se permite.
        if (!origin || env.corsOrigins.includes(origin) || isKnownCodespacesOrigin(origin)) {
          return callback(null, true);
        }
        callback(new Error(`Origen no permitido por CORS: ${origin}`));
      },
      credentials: true,
    })
  );
  // Subido de 5mb a 15mb para admitir la carga de pedidos por Excel (ver
  // orders.routes.ts POST /orders/import): el fichero viaja en base64 dentro
  // del JSON, que infla su tamaño real en torno a un 35%.
  app.use(express.json({ limit: "15mb" }));
  app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));

  // Health-check de infraestructura: comprueba también la conexión a BD, para que un
  // orquestador (Docker/K8s/balanceador) no marque el servicio como sano si Postgres
  // no responde, aunque el proceso Node siga vivo.
  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "connected", ts: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ status: "error", database: "disconnected", ts: new Date().toISOString() });
    }
  });

  app.use("/api/auth", authRouter);

  // Consulta pública de estado de pedido por Nº de pedido + código postal,
  // sin usuario ni contraseña (ver tracking.routes.ts) -- deliberadamente
  // fuera de requireAuth, con su propio rate-limit por IP.
  app.use("/api/tracking", trackingRouter);

  // Todo lo demás requiere autenticación.
  app.use("/api/customers", requireAuth, customersRouter);
  app.use("/api/delivery-points", requireAuth, deliveryPointsRouter);
  app.use("/api/products", requireAuth, productsRouter);
  app.use("/api/carriers", requireAuth, carriersRouter);
  app.use("/api/vehicles", requireAuth, vehiclesRouter);
  app.use("/api/rates", requireAuth, ratesRouter);
  app.use("/api/orders", requireAuth, ordersRouter);
  app.use("/api/routes", requireAuth, routesRouter);
  // Montado en /api/optimization (no /api/routes) porque así lo espera ya el
  // frontend (PlannerPage.tsx llama a `/optimization/:routeId/simulate`).
  app.use("/api/optimization", requireAuth, optimizationRouter);
  app.use("/api/shipments", requireAuth, shipmentsRouter);
  app.use("/api/returns", requireAuth, returnsRouter);
  app.use("/api/billing", requireAuth, billingRouter);
  app.use("/api/dashboard", requireAuth, dashboardRouter);
  app.use("/api/warehouses", requireAuth, warehousesRouter);
  app.use("/api/zones", requireAuth, zonesRouter);
  app.use("/api/users", requireAuth, requireRole("admin_empresa", "admin_plataforma"), usersRouter);
  // Motor de inteligencia (1/3): detección de anomalías -- ver
  // anomaly-detection.service.ts. Piezas 2 y 3 (forecast de demanda,
  // auto-optimización de rutas) pendientes de integrar.
  app.use("/api/intelligence/anomalies", requireAuth, anomalyRouter);

  // Portales externos: autenticación independiente (mismo /api/auth/login, distinto
  // userType) pero scope restringido por carrierId/driverId, reforzado en cada router.
  app.use("/api/carrier-portal", requireAuth, carrierPortalRouter);
  app.use("/api/driver-app", requireAuth, driverAppRouter);
  app.use("/api/customer-portal", requireAuth, customerPortalRouter);

  // Bridge de importación de pedidos desde ERP Claude: aplica su propio
  // rate-limit + requireAuth internamente (ver erpclaud.routes.ts) porque el
  // limitador por IP debe correr ANTES de resolver el token.
  app.use("/api/integrations/erpclaud", erpclaudRouter);

  app.use((_req, res) => res.status(404).json({ message: "Not found" }));
  app.use(errorHandler);

  return app;
}
