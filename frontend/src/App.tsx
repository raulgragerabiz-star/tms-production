import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "@/store/auth-store";
import LoginPage from "@/pages/LoginPage";
import AppLayout from "@/layouts/AppLayout";
import DashboardPage from "@/pages/DashboardPage";
import OrdersPage from "@/pages/OrdersPage";
import PlannerPage from "@/pages/PlannerPage";
import SeguimientoPage from "@/pages/SeguimientoPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import CustomersPage from "@/pages/masters/CustomersPage";
import ProductsPage from "@/pages/masters/ProductsPage";
import CarriersPage from "@/pages/masters/CarriersPage";
import VehiclesPage from "@/pages/masters/VehiclesPage";
import UsersPage from "@/pages/masters/UsersPage";
import WarehousesPage from "@/pages/masters/WarehousesPage";
import InfluenceZonesPage from "@/pages/masters/InfluenceZonesPage";
import RatesPage from "@/pages/RatesPage";
import ReturnsPage from "@/pages/ReturnsPage";
import BillingPage from "@/pages/BillingPage";

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
        <Route path="analitica" element={<AnalyticsPage />} />
        <Route path="tarifas" element={<RatesPage />} />
        <Route path="retornos" element={<ReturnsPage />} />
        <Route path="facturacion" element={<BillingPage />} />
        <Route path="maestros/clientes" element={<CustomersPage />} />
        <Route path="maestros/productos" element={<ProductsPage />} />
        <Route path="maestros/transportistas" element={<CarriersPage />} />
        <Route path="maestros/flota" element={<VehiclesPage />} />
        <Route path="maestros/usuarios" element={<UsersPage />} />
        <Route path="maestros/almacenes" element={<WarehousesPage />} />
        <Route path="maestros/zonas-influencia" element={<InfluenceZonesPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
