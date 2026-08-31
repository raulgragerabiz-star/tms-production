import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "@/api/client";
import { logoutCustomerPortal } from "@/api/auth";

interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  requestedDeliveryDate: string;
  serviceType: string;
  deliveryPoint: { label: string; city: string };
}

const STATUS_LABEL: Record<string, string> = {
  received: "Recibido",
  validated: "Validado",
  planned: "Planificado",
  loading: "En carga",
  dispatched: "Expedido",
  in_transit: "En reparto",
  delivered: "Entregado",
  incident: "Incidencia",
  cancelled: "Cancelado",
};

const STATUS_COLOR: Record<string, string> = {
  received: "bg-slate-100 text-slate-700",
  validated: "bg-slate-100 text-slate-700",
  planned: "bg-blue-100 text-blue-700",
  loading: "bg-blue-100 text-blue-700",
  dispatched: "bg-blue-100 text-blue-700",
  in_transit: "bg-amber-100 text-amber-700",
  delivered: "bg-green-100 text-green-700",
  incident: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
};

export default function OrdersPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["customer-orders", search],
    queryFn: async () => {
      const res = await apiClient.get<{ orders: OrderSummary[] }>("/orders", {
        params: search ? { search } : {},
      });
      return res.data.orders;
    },
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">Mis pedidos</h1>
        <button
          onClick={() => {
            logoutCustomerPortal();
            window.location.href = "/login";
          }}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          Cerrar sesión
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        <input
          type="text"
          placeholder="Buscar por número de pedido..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-4 py-2 text-sm"
        />

        {isLoading && <p className="text-sm text-slate-500">Cargando pedidos...</p>}

        <ul className="divide-y divide-slate-200 bg-white rounded-lg shadow">
          {data?.map((order) => (
            <li key={order.id}>
              <Link
                to={`/pedidos/${order.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800">{order.orderNumber}</p>
                  <p className="text-xs text-slate-500">
                    {order.deliveryPoint.label} — {order.deliveryPoint.city}
                  </p>
                </div>
                <span
                  className={`text-xs font-medium px-2 py-1 rounded-full ${
                    STATUS_COLOR[order.status] ?? "bg-slate-100 text-slate-700"
                  }`}
                >
                  {STATUS_LABEL[order.status] ?? order.status}
                </span>
              </Link>
            </li>
          ))}
          {data?.length === 0 && (
            <li className="px-4 py-6 text-sm text-slate-500 text-center">
              No se han encontrado pedidos.
            </li>
          )}
        </ul>
      </main>
    </div>
  );
}
