import { Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import OrdersPage from "./pages/OrdersPage";
import OrderDetailPage from "./pages/OrderDetailPage";
import TrackOrderPage from "./pages/TrackOrderPage";
import { isLoggedIn } from "./api/auth";

function RequireAuth({ children }: { children: JSX.Element }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Acceso público sin usuario/contraseña: consulta de un pedido por su
          número + código postal (ver TrackOrderPage.tsx). No requiere
          RequireAuth a propósito -- es justamente la vía pensada para no
          tener que dar de alta un usuario de portal por cada cliente. */}
      <Route path="/seguimiento" element={<TrackOrderPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <OrdersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/pedidos/:orderId"
        element={
          <RequireAuth>
            <OrderDetailPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
