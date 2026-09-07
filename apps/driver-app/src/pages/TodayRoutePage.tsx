import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth-store";

interface StopRow {
  id: string;
  sequence: number;
  status: string;
  eta: string | null;
  order: {
    orderNumber: string;
    deliveryTimeWindowFrom: string | null;
    deliveryTimeWindowTo: string | null;
    customer: { legalName: string };
    deliveryPoint: { address: string; city: string | null };
    lines: { quantity: string; unit: string }[];
  };
  pod: { deliveredAt: string } | null;
}

interface TodayRouteResponse {
  shipment: {
    id: string;
    status: string;
    vehicle: { plate: string };
    route: { warehouse: { name: string }; stops: StopRow[] };
  } | null;
}

const statusStyle: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  arrived: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

const statusLabel: Record<string, string> = {
  pending: "Pendiente",
  arrived: "Llegada registrada",
  completed: "Entregado",
  failed: "Fallida",
};

export default function TodayRoutePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const { data, isLoading } = useQuery({
    queryKey: ["today-route"],
    queryFn: async () => (await api.get("/driver-app/today-route")).data as TodayRouteResponse,
    refetchInterval: 30000,
  });

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen pb-8">
      <header className="bg-white border-b border-slate-200 px-4 py-4 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-bold text-brand-700">Ruta de hoy</h1>
          <p className="text-xs text-slate-400">{user?.fullName}</p>
        </div>
        <button onClick={handleLogout} className="text-sm text-slate-500">
          Salir
        </button>
      </header>

      <main className="px-4 pt-4 max-w-lg mx-auto">
        {isLoading && <p className="text-sm text-slate-400 text-center mt-10">Cargando ruta…</p>}

        {!isLoading && !data?.shipment && (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center mt-6">
            <p className="text-slate-500">No tienes ninguna ruta asignada para hoy.</p>
          </div>
        )}

        {data?.shipment && (
          <>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
              <p className="text-sm text-slate-500">{data.shipment.route.warehouse.name}</p>
              <p className="text-lg font-semibold text-slate-900">Vehículo {data.shipment.vehicle.plate}</p>
              <p className="text-xs text-slate-400 mt-1">
                {data.shipment.route.stops.length} paradas ·{" "}
                {data.shipment.route.stops.filter((s) => s.status === "completed").length} completadas
              </p>
            </div>

            <div className="space-y-3">
              {data.shipment.route.stops.map((stop) => (
                <button
                  key={stop.id}
                  onClick={() => navigate(`/paradas/${stop.id}`)}
                  className="w-full text-left bg-white rounded-2xl border border-slate-200 p-4 active:scale-[0.99] transition shadow-sm"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-slate-800">#{stop.sequence} — {stop.order.orderNumber}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusStyle[stop.status]}`}>
                      {statusLabel[stop.status]}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">{stop.order.customer.legalName}</p>
                  <p className="text-sm text-slate-400">
                    {stop.order.deliveryPoint.address}
                    {stop.order.deliveryPoint.city ? `, ${stop.order.deliveryPoint.city}` : ""}
                  </p>
                  {(stop.order.deliveryTimeWindowFrom || stop.order.deliveryTimeWindowTo) && (
                    <p className="text-xs text-amber-600 mt-1">
                      Ventana: {stop.order.deliveryTimeWindowFrom ?? "—"} - {stop.order.deliveryTimeWindowTo ?? "—"}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
