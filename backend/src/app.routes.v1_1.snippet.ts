// ============================================================================
// Añadir estas líneas a tu app.ts / server.ts ya existente, junto al resto
// de app.use(...) de módulos (orders, planning, optimization, shipments...).
// No sustituye ninguna ruta existente — solo añade.
// ============================================================================

import erpclaudRoutes from "./modules/integrations/erpclaud/erpclaud.routes";
import driverAppRoutesV1_1 from "./modules/driver-app/driver-app.routes.v1_1";
import customerPortalRoutes from "./modules/customer-portal/customer-portal.routes";
import optimizationSimulationsRoutes from "./modules/optimization/optimization.simulations.routes";
import settlementDisputeRoutes from "./modules/settlement/settlement-dispute.routes";
import shipmentChatRoutes from "./modules/chat/shipment-chat.routes";
import kpiRoutes from "./modules/kpi/kpi.routes";
import kpiExportRoutes from "./modules/kpi/kpi-export.routes";
import scheduledReportsRoutes from "./modules/reports/scheduled-reports.routes";
import anomalyRoutes from "./modules/intelligence/anomaly.routes";
import demandForecastRoutes from "./modules/intelligence/demand-forecast.routes";

// ...

app.use("/api/integrations/erpclaud", erpclaudRoutes);
app.use("/api/driver-app", driverAppRoutesV1_1); // adicional sobre el driver-app.routes.ts ya existente
app.use("/api/customer-portal", customerPortalRoutes);
app.use("/api/optimization", optimizationSimulationsRoutes); // adicional sobre optimization.routes.ts ya existente — cierra CandidatesModal
app.use("/api", settlementDisputeRoutes); // expone /carrier-portal/settlement-lines/:id/dispute e /internal/settlement-lines/:id/resolve-dispute
app.use("/api", shipmentChatRoutes); // expone /shipments/:id/messages y /carrier-portal/shipments/:id/messages
app.use("/api/kpis", kpiRoutes);
app.use("/api/kpis", kpiExportRoutes); // expone /kpis/export
app.use("/api/scheduled-reports", scheduledReportsRoutes);
app.use("/api/anomalies", anomalyRoutes);
app.use("/api/demand-forecast", demandForecastRoutes);

// CORS: añadir el puerto/subdominio de la nueva app apps/customer-portal
// (5176 en local, o el subdominio *-5176.app.github.dev en Codespaces)
// al mismo array de orígenes permitidos que ya usan backoffice/carrier-portal/driver-app.

// Pasada 8 — Optimización automática opt-in
import companySettingsRoutes from "./modules/intelligence/company-settings.routes";
app.use("/api/company/settings", companySettingsRoutes);
// El "gancho" que dispara autoAssignRouteIfEligible NO es una ruta nueva:
// ver backend/src/optimization.hook.snippet.ts — se integra dentro de tu
// controller de optimización ya existente, no aquí.
