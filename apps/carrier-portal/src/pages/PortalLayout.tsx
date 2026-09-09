import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth-store";
import bigmatWordmark from "@/assets/bigmat-wordmark.png";

function linkClass({ isActive }: { isActive: boolean }) {
  return `px-4 py-2 rounded-lg text-sm font-medium ${isActive ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`;
}

export default function PortalLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={bigmatWordmark} alt="BigMat" className="h-6" />
            <div>
              <h1 className="text-base font-bold text-brand-700">Portal Transportista</h1>
              <p className="text-xs text-slate-400">{user?.fullName}</p>
            </div>
          </div>
          <nav className="flex gap-1">
            <NavLink to="/" end className={linkClass}>
              Tareas
            </NavLink>
            <NavLink to="/viajes" className={linkClass}>
              Mis viajes
            </NavLink>
            <NavLink to="/liquidaciones" className={linkClass}>
              Liquidaciones
            </NavLink>
          </nav>
          <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-700">
            Salir
          </button>
        </div>
      </header>
      <main className="max-w-4xl mx-auto p-4">
        <Outlet />
      </main>
    </div>
  );
}
