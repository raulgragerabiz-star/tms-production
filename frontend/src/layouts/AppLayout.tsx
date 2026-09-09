import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth-store";

const navItems = [
  { to: "/", label: "Inicio", end: true },
  { to: "/pedidos", label: "Pedidos" },
  { to: "/planificador", label: "Planificador" },
  { to: "/seguimiento", label: "Seguimiento" },
  { to: "/analitica", label: "Analítica" },
  { to: "/alertas", label: "Alertas" },
  { to: "/prevision-demanda", label: "Previsión de demanda" },
  { to: "/retornos", label: "Retornos" },
  { to: "/facturacion", label: "Facturación" },
];

// 2026-09-09: petición de Raúl -- "compactar todo lo relacionado con
// transportista y flotas [en] un solo acceso en el menú lateral + pestañas".
// Transportistas, Flota (que ya tenía Vehículos/Conductores/Tipos como
// sub-pestañas) y el "Tarifas" de nivel superior de arriba se sustituyen por
// un único acceso -- ver CarrierFleetPage, con las 5 pestañas que pidió
// (Empresa, Tarifas, Vehículos, Conductores, Tipo de vehículo).
const masterItems = [
  { to: "/maestros/clientes", label: "Clientes" },
  { to: "/maestros/productos", label: "Productos" },
  { to: "/maestros/flota-transportistas", label: "Flota y Transportistas" },
  { to: "/maestros/usuarios", label: "Usuarios" },
  { to: "/maestros/almacenes", label: "Almacenes" },
  { to: "/maestros/zonas-influencia", label: "Zonas de influencia" },
];

function linkClass({ isActive }: { isActive: boolean }) {
  return `block px-3 py-2 rounded-lg text-sm font-medium ${
    isActive ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
  }`;
}

export default function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-4 py-5 border-b border-slate-100">
          <h1 className="text-lg font-bold text-brand-700">TMS Expediciones</h1>
          <p className="text-xs text-slate-400 mt-0.5">{user?.fullName}</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              {item.label}
            </NavLink>
          ))}

          <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Maestros
          </p>
          {masterItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-slate-100">
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
