import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "@/store/auth-store";
import LoginPage from "@/pages/LoginPage";
import AppLayout from "@/layouts/AppLayout";
import DashboardPage from "@/pages/DashboardPage";
import OrdersPage from "@/pages/OrdersPage";
import PlannerPage from "@/pages/PlannerPage";
import SeguimientoPage from "@/pages/SeguimientoPage";
import CustomersPage from "@/pages/masters/CustomersPage";
import ProductsPage from "@/pages/masters/ProductsPage";
import CarrierFleetPage from "@/pages/masters/CarrierFleetPage";
import UsersPage from "@/pages/masters/UsersPage";
import WarehousesPage from "@/pages/masters/WarehousesPage";
import InfluenceZonesPage from "@/pages/masters/InfluenceZonesPage";
import SegmentationRulesPage from "@/pages/masters/SegmentationRulesPage";
import ReturnsPage from "@/pages/ReturnsPage";
import BillingPage from "@/pages/BillingPage";
import CompanySettingsPage from "@/pages/CompanySettingsPage";

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="pedidos" element={<OrdersPage />} />
        <Route path="planificador" element={<PlannerPage />} />
        <Route path="seguimiento" element={<SeguimientoPage />} />
        {/* Fase 8V: Analítica/Alertas/Previsión se consolidaron en un solo
            acceso (AnalyticsHubPage). Las rutas antiguas /alertas y
            /prevision-demanda ya no existían; caían en el comodín "*" de
            abajo.
            Fase 29 (2026-09-23): petición explícita de Raúl -- "unifica esos
            datos analíticos con los KPI dentro de la pestaña Inicio...
            elimina de la ecuación las alertas y la previsión de demanda...
            retirar las partes no productivas". AnalyticsHubPage desaparece
            por completo: su pestaña "KPIs" (AnalyticsPage) pasa a ser la
            segunda pestaña de Inicio (ver DashboardPage.tsx), y sus
            pestañas "Alertas" (AnomaliesPage) y "Previsión de demanda"
            (DemandForecastPage) se retiran de Backoffice sin sustituto --
            Raúl las considera no productivas. /analitica ya no existe;
            cualquier enlace guardado cae en el comodín "*" y redirige a
            Inicio, mismo comportamiento que toda consolidación anterior de
            este menú. El backend de anomalías/previsión NO se toca (sigue
            en uso interno por auto-optimización y dimensionado de flota). */}
        {/* Fase 29: "Retornos" deja de ser un acceso de nivel superior (Raúl:
            "no es operativa") y pasa a vivir como sub-pestaña de Maestros --
            misma pantalla (ReturnsPage), solo cambia dónde se llega a ella.
            /retornos ya no existe; cae en el comodín "*" igual que /analitica. */}
        <Route path="facturacion" element={<BillingPage />} />
        <Route path="configuracion" element={<CompanySettingsPage />} />
        <Route path="maestros/clientes" element={<CustomersPage />} />
        <Route path="maestros/productos" element={<ProductsPage />} />
        <Route path="maestros/flota-transportistas" element={<CarrierFleetPage />} />
        <Route path="maestros/usuarios" element={<UsersPage />} />
        <Route path="maestros/almacenes" element={<WarehousesPage />} />
        <Route path="maestros/zonas-influencia" element={<InfluenceZonesPage />} />
        <Route path="maestros/segmentacion" element={<SegmentationRulesPage />} />
        <Route path="maestros/retornos" element={<ReturnsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
