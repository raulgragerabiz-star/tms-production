import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "@/store/auth-store";
import LoginPage from "@/pages/LoginPage";
import TodayRoutePage from "@/pages/TodayRoutePage";
import StopDetailPage from "@/pages/StopDetailPage";
import ScanVehicleQrPage from "@/pages/ScanVehicleQrPage";

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
            <TodayRoutePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/paradas/:id"
        element={
          <ProtectedRoute>
            <StopDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/escanear-vehiculo"
        element={
          <ProtectedRoute>
            <ScanVehicleQrPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
