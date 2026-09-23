import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "@/store/auth-store";
import LoginPage from "@/pages/LoginPage";
import TodayRoutePage from "@/pages/TodayRoutePage";
import StopDetailPage from "@/pages/StopDetailPage";
import ScanStopCodePage from "@/pages/ScanStopCodePage";

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Fase 25 ("usuarios app" sub-fase 3): LoginPage ahora ES el
          escaneo del QR de ruta + formulario de identificación -- sustituye
          del todo al login por email/contraseña y al QR de vehículo (antes
          en /escanear-acceso, ver ScanToLoginPage.tsx, retirada). Sin
          ProtectedRoute -- todavía no hay ningún token en este punto. */}
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
      {/* Fase 8L: "Escáner de códigos" de la barra de acciones de una
          parada -- ver ScanStopCodePage.tsx. */}
      <Route
        path="/paradas/:id/escanear"
        element={
          <ProtectedRoute>
            <ScanStopCodePage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
