import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "@/store/auth-store";
import LoginPage from "@/pages/LoginPage";
import PortalLayout from "@/pages/PortalLayout";
import InboxPage from "@/pages/InboxPage";
import ShipmentsPage from "@/pages/ShipmentsPage";
import ShipmentDetailPage from "@/pages/ShipmentDetailPage";
import SettlementsPage from "@/pages/SettlementsPage";

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
            <PortalLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<InboxPage />} />
        <Route path="viajes" element={<ShipmentsPage />} />
        <Route path="viajes/:id" element={<ShipmentDetailPage />} />
        <Route path="liquidaciones" element={<SettlementsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
